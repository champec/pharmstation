# NHS 111 Adaptor — Railway Deployment Guide

> Step-by-step guide to deploy the NHS 111 message receiving infrastructure on [Railway](https://railway.app).

## Architecture Overview

```
NHS 111 ──(ITK SOAP/CDA XML)──► Adaptor ──(FHIR JSON)──► RabbitMQ ──► Bridge ──(HTTPS)──► Supabase Edge Function
              port 8080              nhsdev/nia-111-adaptor    port 5672      Node.js           nhs111-receive
```

Three Railway services, all on a shared internal network:

| Service    | Image / Build                         | Purpose                                    | Est. Cost |
|------------|---------------------------------------|--------------------------------------------|-----------|
| RabbitMQ   | `rabbitmq:3-management-alpine`        | Message broker between adaptor and bridge  | ~$2/mo    |
| Adaptor    | `nhsdev/nia-111-adaptor:1.0.5-amd64`  | Converts ITK XML → FHIR JSON → AMQP       | ~$2/mo    |
| Bridge     | Custom Dockerfile (Node.js)           | Consumes AMQP → POSTs to Supabase         | ~$1/mo    |

**Total estimated cost: ~$5/month**

---

## Prerequisites

- [Railway account](https://railway.app) (Hobby plan, $5/month includes usage credits)
- Your Supabase anon key (from Dashboard → Settings → API)
- Git (the bridge Dockerfile is in this repo)

---

## Step 1: Create a Railway Project

1. Go to [railway.app/new](https://railway.app/new)
2. Click **"Empty Project"**
3. Name it `pharmstation-nhs111`

---

## Step 2: Deploy RabbitMQ

1. In your Railway project, click **"+ New"** → **"Database"** → **"Add RabbitMQ"**
   - Railway has a one-click RabbitMQ template. Use it!
   - Alternatively: **"+ New"** → **"Docker Image"** → enter `rabbitmq:3-management-alpine`
2. If using Docker Image, add these environment variables:
   ```
   RABBITMQ_DEFAULT_USER=pharmstation
   RABBITMQ_DEFAULT_PASS=<generate-a-strong-password>
   ```
3. Note the **internal hostname** Railway assigns (e.g., `rabbitmq.railway.internal`)
4. The AMQP port is `5672` (internal, no need to expose publicly)

---

## Step 3: Deploy the NHS 111 Adaptor

1. Click **"+ New"** → **"Docker Image"**
2. Enter: `nhsdev/nia-111-adaptor:1.0.5-amd64`
   - For ARM-based Railway runners, use `1.0.5-arm64` instead
3. Add these **environment variables**:

   | Variable | Value |
   |----------|-------|
   | `PEM111_AMQP_BROKER` | `amqp://rabbitmq.railway.internal:5672` (use the internal hostname from Step 2) |
   | `PEM111_AMQP_PORT` | `5672` |
   | `PEM111_AMQP_PROTOCOL` | `0-9-1` |
   | `PEM111_AMQP_QUEUE_NAME` | `encounter-report` |
   | `PEM111_AMQP_USERNAME` | `pharmstation` (same as RabbitMQ) |
   | `PEM111_AMQP_PASSWORD` | `<same-password-as-rabbitmq>` |
   | `PEM111_AMQP_EXCHANGE` | **`jms.durable.queues`** ⚠️ **MUST be set** — see "Troubleshooting" below |
   | `PEM111_AMQP_ROUTING_KEY` | `encounter-report` |
   | `JAVA_TOOL_OPTIONS` | `-XX:-UseContainerSupport` (fixes CgroupV2 crash on Railway) |
   | `MANAGEMENT_METRICS_BINDERS_PROCESSOR_ENABLED` | `false` |
   | `PEM111_ITK_EXTERNAL_CONFIGURATION_URL` | `https://xsqwpmqfbirqdncoephf.supabase.co/functions/v1/get-ods-dos-codes?token=<ODS_CONFIG_TOKEN>` |
   | `PEM111_ITK_FETCH_INTERVAL_MIN` | `60` |
   | `PEM111_SOAP_VALIDATION_ENABLED` | `false` |
   | `LOG_LEVEL` | `INFO` |

4. Under **Settings** → **Networking**:
   - Click **"Generate Domain"** to get a public URL
   - This is the URL NHS 111 will send ITK messages to (port 8080 mapped automatically)
   - The endpoint will be `https://<your-domain>.railway.app/report`

---

## Step 4: Deploy the Bridge

1. Click **"+ New"** → **"GitHub Repo"**
   - Connect your PharmStation repo
   - Set **Root Directory** to: `infrastructure/nhs111/bridge`
   - Railway will auto-detect the Dockerfile
2. **Alternatively**, deploy from the Docker image directly:
   - Click **"+ New"** → **"Docker Image"**
   - Build and push the bridge image to Docker Hub/GHCR first, then reference it
3. Add these **environment variables**:

   | Variable | Value |
   |----------|-------|
   | `RABBITMQ_URL` | `amqp://pharmstation:<password>@rabbitmq.railway.internal:5672` |
   | `RABBITMQ_QUEUE` | `encounter-report` |
   | `SUPABASE_FUNCTION_URL` | `https://xsqwpmqfbirqdncoephf.supabase.co/functions/v1/nhs111-receive` |
   | `SUPABASE_ANON_KEY` | `<your-supabase-anon-key>` |
   | `NHS111_BRIDGE_SECRET` | `<same value as the nhs111-receive function secret>` |
   | `LOG_LEVEL` | `info` |

4. Under **Settings** → **Networking**: No public domain needed (bridge is internal only)

---

## Step 5: Verify Deployment

### 5a. Check RabbitMQ
- Temporarily expose the management port (15672) or use Railway's port forwarding
- Login with your credentials
- You should see the `encounter-report` queue listed

### 5b. Check Adaptor Health
- Visit: `https://<your-adaptor-domain>.railway.app/actuator/health`
- Should return `{"status":"UP"}`

### 5c. Check Bridge Logs
- In Railway dashboard, click on the Bridge service → **Logs**
- You should see: `PharmStation NHS 111 Bridge starting`
- Then: `Connected to RabbitMQ`
- Then: `Waiting for messages on queue "encounter-report"...`

### 5d. Send a Test Message
```bash
curl -i --location --request POST 'https://<your-adaptor-domain>.railway.app/report' \
     --data '@test-itk-message.xml' \
     -H "Content-Type: application/xml"
```

You can find sample ITK XML messages in the [adaptor repo](https://github.com/NHSDigital/integration-adaptor-111/tree/main/doc/xml).

After sending, check:
1. RabbitMQ management → `encounter-report` queue should show the message was consumed
2. Bridge logs → Should show "Successfully forwarded FHIR bundle to Supabase"
3. PharmStation UI → Navigate to Services → 111 Referrals → The referral should appear

---

## Step 6: Production Considerations

### TLS Mutual Authentication
The live NHS 111 network requires TLS-MA (mutual TLS). You'll need to:

1. Add an **NGINX reverse proxy** service in front of the adaptor
2. Use the `nhsdev/nia-111-nginx-adaptor` Docker image
3. Configure these additional environment variables:
   ```
   NGINX_PUBLIC_CERT=<your-server-public-cert>
   NGINX_PRIVATE_CERT=<your-server-private-key>
   NGINX_CLIENT_PUBLIC_CERT=<nhs-client-cert>
   NGINX_CA_CERT=<root-ca-cert>
   NGINX_ADAPTER_HOSTNAME=adaptor.railway.internal
   NGINX_ADAPTER_PORT=8080
   ```
4. NHS 111 will send to the NGINX endpoint (port 443) instead of directly to the adaptor

### NHS Onboarding
To receive real NHS 111 messages, you need to:
1. Register with NHS Digital for the 111 integration
2. Get your endpoint registered in the **DoS (Directory of Services)**
3. Complete the **Connection Agreement** process
4. Obtain TLS-MA certificates from NHS
5. Set `PEM111_SOAP_VALIDATION_ENABLED=true`

### Monitoring
- Set up Railway **alerts** for service restarts
- Monitor the Bridge logs for `failed` counts
- Consider adding a health-check endpoint to the Bridge

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Adaptor won't start | Check `PEM111_ITK_EXTERNAL_CONFIGURATION_URL` is reachable. The adaptor validates this on startup. |
| **Adaptor crashes with NullPointerException (CgroupV2)** | Add `JAVA_TOOL_OPTIONS=-XX:-UseContainerSupport` to the adaptor environment. Railway uses CgroupV2 which older JVMs don't handle. |
| **Bridge connected but no messages arrive** | **Most common issue.** Ensure `PEM111_AMQP_EXCHANGE=jms.durable.queues` is set on the adaptor. The adaptor uses the RabbitMQ JMS client which publishes to this exchange. Without it, `isAmqpWritable()` returns false and messages go through a JMS-internal path the bridge can't consume from. |
| `dosIds` NullPointerException | The `get-ods-dos-codes` function must return `dosIds: []` (empty array), NOT `null`. |
| Bridge can't connect to RabbitMQ | Verify the internal hostname and credentials match. Check Railway internal networking. |
| Messages not appearing in PharmStation | Check Bridge logs for HTTP errors. Verify `SUPABASE_FUNCTION_URL`, `SUPABASE_ANON_KEY` and `NHS111_BRIDGE_SECRET`. A 401 means the bridge secret doesn't match. |
| Adaptor rejects messages | Check ODS codes are correctly configured in your `pharmacies` table. The `get-ods-dos-codes` function returns them. |
| "Queue not found" errors | The adaptor creates the queue on first message. Send a test message first. Or check the bridge — it also asserts the queue. |
| `railway up` deploys wrong files | Clear "Root Directory" in Railway dashboard → Service Settings → Build if previously set from a GitHub deploy. |

---

## File Reference

```
infrastructure/nhs111/
├── docker-compose.yml    # Local development compose (3 services)
├── .env.example          # Environment variable template
├── README.md             # This file
└── bridge/
    ├── Dockerfile        # Bridge container (Node.js 18 Alpine)
    ├── index.js          # AMQP consumer + HTTP forwarder
    └── package.json      # Dependencies (amqplib)
```
