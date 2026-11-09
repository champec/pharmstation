// ============================================================
// /shop/terms — terms of sale and returns for pharmacy shops.
// Each pharmacy is the seller; PharmStation runs the shop software.
// Covers the Consumer Contracts Regulations 2013 14-day cancellation right,
// with the hygiene / sealed-medicine exception, refunds and pharmacist checks.
// ============================================================

import { Link } from 'react-router-dom'
import { PublicSiteShell } from '../../components/public/PublicSiteShell'
import { usePageTitle } from '../../seo/RouteMeta'

const h2Style = { borderBottom: '1px solid var(--ps-border)', paddingBottom: 'var(--ps-space-xs)', marginBottom: 'var(--ps-space-sm)' }
const pStyle = { margin: '0 0 var(--ps-space-sm)', color: 'var(--ps-slate)' }

export function ShopTermsPage() {
  usePageTitle('Shop terms and returns')
  return (
    <PublicSiteShell>
      <article className="public-panel public-doc">
        <div style={{ textAlign: 'center', marginBottom: 'var(--ps-space-xl)' }}>
          <h1 style={{ marginBottom: 'var(--ps-space-sm)' }}>Shop terms and returns</h1>
          <p style={{ color: 'var(--ps-slate)' }}>For orders from pharmacies on the PharmStation shop</p>
          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-text-sm)' }}>Last updated: 9 November 2026</p>
        </div>

        <div style={{ display: 'grid', gap: 'var(--ps-space-lg)' }}>
          <section>
            <h2 style={h2Style}>1. Who you are buying from</h2>
            <p style={pStyle}>
              When you order from a pharmacy's shop, your contract is with that pharmacy. Its name, address, GPhC premises
              number and the pharmacist in charge are shown on its shop page. PharmStation provides the shop software and
              does not sell, supply or dispense anything itself.
            </p>
          </section>

          <section>
            <h2 style={h2Style}>2. Pharmacy medicines</h2>
            <p style={pStyle}>
              Some products are pharmacy (P) medicines. Before one is supplied, you answer a few questions and a pharmacist
              checks your answers. The pharmacist may contact you, ask for more information, or decide the medicine isn't
              suitable. If they can't supply it, the order is cancelled and any card payment is refunded in full.
              Please answer honestly: the questions are there to keep you safe. Prescription-only medicines are not sold
              through the shop.
            </p>
          </section>

          <section>
            <h2 style={h2Style}>3. Prices and payment</h2>
            <p style={pStyle}>
              Prices are in pounds sterling and include any VAT that applies. Delivery charges are shown before you order.
              Depending on the pharmacy, you pay by card when you order (processed securely by Stripe for the pharmacy),
              or in store when you collect, or on delivery.
            </p>
          </section>

          <section>
            <h2 style={h2Style}>4. Collection and delivery</h2>
            <p style={pStyle}>
              The pharmacy tells you when your order is ready to collect or out for delivery. If it uses text messages, these
              go to the number you give at checkout. Deliveries are only made within the pharmacy's delivery area. You can
              check your order at any time on the{' '}
              <Link to="/shop/order">order tracking page</Link> with your order number and phone number.
            </p>
          </section>

          <section>
            <h2 style={h2Style}>5. Cancelling an order</h2>
            <p style={pStyle}>
              You can cancel an order any time before it is collected or sent out by contacting the pharmacy. If you paid by
              card, you get a full refund. The pharmacy may also cancel an order, for example if an item is out of stock or a
              pharmacist decides a medicine isn't suitable. If it does, you are told and refunded in full.
            </p>
          </section>

          <section>
            <h2 style={h2Style}>6. Your 14-day right to return</h2>
            <p style={pStyle}>
              Under the Consumer Contracts Regulations 2013 you can change your mind about a delivered order within 14 days of
              receiving it, without giving a reason. Tell the pharmacy within those 14 days, then return the items within a
              further 14 days. You get your money back, including the standard delivery charge, within 14 days of the pharmacy
              receiving the items back.
            </p>
            <p style={pStyle}>
              This right doesn't apply to items sealed for health or hygiene reasons once the seal has been broken. For
              safety, pharmacies cannot take back medicines once they have left the pharmacy unless they are faulty, as
              returned medicines can't be resold or reused.
            </p>
          </section>

          <section>
            <h2 style={h2Style}>7. Faulty or wrong items</h2>
            <p style={pStyle}>
              If something arrives damaged, faulty or isn't what you ordered, contact the pharmacy straight away. You are
              entitled to a repair, replacement or refund under the Consumer Rights Act 2015. This doesn't affect your
              statutory rights.
            </p>
          </section>

          <section>
            <h2 style={h2Style}>8. Your information</h2>
            <p style={pStyle}>
              The pharmacy uses your name, phone number, address and any answers you give to process your order and, for
              medicines, to keep a record of the pharmacist's check, as the law requires. See our{' '}
              <Link to="/privacy">privacy notice</Link> for how your data is handled.
            </p>
          </section>

          <section>
            <h2 style={h2Style}>9. Complaints</h2>
            <p style={pStyle}>
              Please contact the pharmacy first. If you're not happy with how it handles a concern about a pharmacy's service
              or a pharmacist, you can contact the General Pharmaceutical Council (GPhC). For problems with the shop website
              itself, email <a href="mailto:hello@pharmstation.co.uk">hello@pharmstation.co.uk</a>.
            </p>
          </section>
        </div>
      </article>
    </PublicSiteShell>
  )
}
