import { type ReactNode } from "react";

const contactHref = "mailto:license@supaterm.com";

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto min-h-screen max-w-[820px] px-6 pb-24 pt-28 text-white/68 md:px-10 md:pt-36">
      <h1 className="text-4xl font-medium tracking-[-0.04em] text-[#f4f0e8] md:text-5xl">
        {title}
      </h1>
      <p className="mt-4 text-sm text-white/42">Effective 25 August 2026</p>
      <div className="mt-12 space-y-10 leading-7 [&_a]:text-[#f5bf6d] [&_a]:underline-offset-4 [&_a:hover]:underline [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-[-0.03em] [&_h2]:text-[#f4f0e8] [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">
        {children}
      </div>
    </article>
  );
}

function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <section>
        <h2>Who we are</h2>
        <p>
          Supaterm Limited provides Supaterm. Our registered address is 71–75 Shelton Street,
          London, WC2H 9JQ, United Kingdom. Contact us at{" "}
          <a href={contactHref}>license@supaterm.com</a>.
        </p>
      </section>
      <section>
        <h2>The product</h2>
        <p>
          Supaterm is macOS software. Free mode supports up to five open tabs. A paid personal
          license removes that limit on one Mac at a time. You may deactivate it and move it to
          another Mac.
        </p>
      </section>
      <section>
        <h2>Perpetual license and updates</h2>
        <p>
          Your paid license lets you keep using every Supaterm release published on or before the
          end of its update period. The initial purchase includes 365 days of updates. You do not
          have to renew. A separate one-off renewal adds another 365 days of updates and does not
          create a subscription.
        </p>
      </section>
      <section>
        <h2>Payment and delivery</h2>
        <p>
          Prices are in US dollars. Stripe shows and charges any tax that applies before payment. We
          supply the license key on the confirmation page and by email after Stripe confirms
          payment.
        </p>
        <p className="mt-4">
          By completing checkout, you ask us to supply the digital content at once and acknowledge
          that your statutory cancellation right may end when supply begins.
        </p>
      </section>
      <section>
        <h2>Refunds</h2>
        <p>
          Our voluntary refund terms appear in our <a href="/refunds">refund policy</a>. They do not
          limit rights that the law gives you.
        </p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not share, sell, rent, reverse engineer, or bypass a license key or paid-mode check,
          except where the law gives you a right that we cannot restrict. Do not use the service to
          harm it or other users.
        </p>
      </section>
      <section>
        <h2>Availability and liability</h2>
        <p>
          We provide Supaterm with reasonable care. Software may contain faults, and online license
          services may stop for maintenance or events outside our control. We do not exclude
          liability that the law does not let us exclude. Otherwise, our total liability arising
          from a purchase will not exceed the amount you paid for it.
        </p>
      </section>
      <section>
        <h2>Law</h2>
        <p>
          The laws of England and Wales govern these terms. Consumers keep all mandatory rights
          under the laws that apply where they live.
        </p>
      </section>
    </LegalPage>
  );
}

function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <section>
        <h2>Data we collect</h2>
        <ul>
          <li>Contact and payment records, including your email and Stripe customer reference.</li>
          <li>License records, payment state, update period, and refund or dispute state.</li>
          <li>A hashed device identifier, device name, app version, and activation dates.</li>
          <li>Website and app use data, error reports, IP-based rate limits, and security logs.</li>
        </ul>
        <p className="mt-4">We do not store your card number. Stripe handles card details.</p>
      </section>
      <section>
        <h2>How we use data</h2>
        <p>
          We use data to take payment, calculate tax, issue and manage licenses, deliver updates,
          prevent abuse, answer support requests, improve Supaterm, and meet legal and accounting
          duties.
        </p>
      </section>
      <section>
        <h2>Service providers</h2>
        <p>
          Stripe processes payments and tax data. Cloudflare hosts the site, license service,
          database, logs, and email delivery. PostHog provides product analytics and error reports.
          GitHub hosts release files. These providers process data under their own terms and may
          process it outside your country. We do not sell personal data.
        </p>
      </section>
      <section>
        <h2>Analytics</h2>
        <p>
          Our site and app use PostHog to measure use and faults. The site may store an anonymous
          identifier in your browser. You can block this storage with your browser settings.
        </p>
      </section>
      <section>
        <h2>Retention and your rights</h2>
        <p>
          We retain license and transaction records while needed to provide your perpetual license,
          prevent fraud, and meet tax and accounting duties. Short-lived sign-in links expire after
          15 minutes and portal sessions after 30 days. You may ask to access, correct, export, or
          delete your personal data. Legal duties may require us to keep some records.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          Email <a href={contactHref}>license@supaterm.com</a> with a privacy request or complaint.
          You may also complain to the data protection authority where you live.
        </p>
      </section>
    </LegalPage>
  );
}

function RefundsPage() {
  return (
    <LegalPage title="Refund and cancellation policy">
      <section>
        <h2>Seven-day refund</h2>
        <p>
          You may request a full refund of the initial Supaterm license purchase within seven days
          of payment. Sign in through{" "}
          <a href="https://license.supaterm.com/login">Manage licenses</a>
          to request it, or email <a href={contactHref}>license@supaterm.com</a> from the address
          used at checkout.
        </p>
      </section>
      <section>
        <h2>What a refund does</h2>
        <p>
          We return funds to the original payment method. A full refund revokes the related license
          and its update rights. Banks and card networks control how long the credit takes to
          appear.
        </p>
      </section>
      <section>
        <h2>Update renewals</h2>
        <p>
          The voluntary seven-day policy covers the initial license purchase, not a later update
          renewal. Contact us at once if you renewed by mistake or if the renewal was not applied.
        </p>
      </section>
      <section>
        <h2>Digital content and statutory rights</h2>
        <p>
          Checkout asks you to agree to immediate supply and acknowledge that your statutory
          cancellation right may end once supply begins. Our policy does not limit rights that the
          law gives you, including rights for faulty or misdescribed digital content.
        </p>
      </section>
      <section>
        <h2>No subscription to cancel</h2>
        <p>
          Supaterm does not renew automatically. A license keeps working for owned releases, and
          each update renewal is a separate one-off purchase.
        </p>
      </section>
    </LegalPage>
  );
}

export { PrivacyPage, RefundsPage, TermsPage };
