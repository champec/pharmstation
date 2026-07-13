---
description: Describe when these instructions should be loaded by the agent based on task context
# applyTo: 'when using supabase, looking for migration files, coding new features involving the database'
---

<!-- Tip: Use /create-instructions in chat to generate content with agent assistance -->

- do not look for sql migration files locally, please use the pharmstation MCP - specifically the pharmstation mcp to get the tables directly, if its not active or doesnt work, tell the user and ask them to correct it if they can do not try any workarounds for database related tasks.
- use npx supabase and project ref which you can get from pharmstation mcp to run any supabase commands, do not try to run supabase commands without the project ref or without using npx in the CLI. the cli is logged in and ready to go and is used also for deploying edge functions, if it doesnt work, tell the user and ask them to correct it if they can do not try any workarounds for database related tasks.