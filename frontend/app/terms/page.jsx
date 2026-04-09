'use client';

import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-3xl font-bold text-white mb-8">Terms of Service</h1>

      <div className="space-y-6">
        {/* Age verification */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 text-xs font-bold">!</span>
            1. Age Requirement
          </h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            You must be at least <strong className="text-white">18 years of age</strong> (or the minimum
            legal gambling age in your jurisdiction, whichever is higher) to use Arena. By creating an
            account or placing any bet, you represent and warrant that you meet this age requirement.
            Arena reserves the right to request proof of age at any time and to suspend accounts that
            fail to provide adequate verification.
          </p>
        </section>

        {/* Jurisdiction */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-3">2. Restricted Jurisdictions</h2>
          <p className="text-sm text-gray-400 leading-relaxed mb-3">
            This platform is <strong className="text-white">not available</strong> in the following
            jurisdictions:
          </p>
          <ul className="list-disc list-inside text-sm text-gray-400 space-y-1 mb-3">
            <li>United States of America</li>
            <li>North Korea</li>
            <li>Iran</li>
            <li>Syria</li>
            <li>Cuba</li>
            <li>Myanmar</li>
            <li>Sudan</li>
            <li>Afghanistan</li>
          </ul>
          <p className="text-sm text-gray-400 leading-relaxed">
            This list may be updated at any time. It is your responsibility to ensure compliance
            with your local laws. Access from restricted jurisdictions is prohibited.
          </p>
        </section>

        {/* VPN prohibition */}
        <section className="card p-6 border-red-500/20">
          <h2 className="text-lg font-semibold text-white mb-3">3. VPN and Proxy Prohibition</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            The use of Virtual Private Networks (VPNs), proxy servers, Tor, or any other technology
            to circumvent geographic restrictions is <strong className="text-red-400">strictly prohibited</strong>.
            If Arena detects that you are using such tools to access the platform from a restricted
            jurisdiction, your account will be <strong className="text-white">immediately suspended</strong>,
            any pending bets will be voided, and your remaining balance may be withheld pending
            investigation. Arena employs advanced detection methods to identify VPN and proxy usage.
          </p>
        </section>

        {/* Gambling disclaimer */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-3">4. Gambling Disclaimer</h2>
          <ul className="list-disc list-inside text-sm text-gray-400 space-y-2">
            <li>Gambling involves risk. You may lose some or all of your deposited funds.</li>
            <li>Past results do not guarantee future outcomes.</li>
            <li>
              You are solely responsible for any tax obligations arising from your winnings
              in your jurisdiction.
            </li>
            <li>
              You should never bet more than you can afford to lose. If you or someone you
              know has a gambling problem, please seek help from organizations such as the
              National Council on Problem Gambling (1-800-522-4700) or equivalent services
              in your country.
            </li>
            <li>
              Arena provides tools for responsible gambling, including deposit limits and
              self-exclusion options. Contact support to enable these features.
            </li>
          </ul>
        </section>

        {/* How betting works */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-3">5. How Betting Works</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Arena uses a <strong className="text-white">seeded parimutuel</strong> betting model.
            All bets on a given round go into a shared pool. When the round settles, a 5% rake is
            deducted from the total pool, and the remainder is distributed proportionally among
            winning bettors.
          </p>
          <p className="text-sm text-gray-400 leading-relaxed mt-3">
            Displayed odds are live estimates based on current pool state. Final payouts are
            calculated at settlement time based on the final pool when betting closes. Odds shift
            as more bets come in.
          </p>
        </section>

        {/* Settlement */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-3">6. Settlement &amp; Transparency</h2>
          <p className="text-sm text-gray-400 leading-relaxed mb-3">
            All bets are settled by a computer vision pipeline that observes public livestream
            camera feeds. By using the platform, you understand and agree that:
          </p>
          <ul className="list-disc list-inside text-sm text-gray-400 space-y-2">
            <li>
              Bet outcomes are determined by AI models analyzing video frames. While we strive for
              accuracy, no AI system is perfect.
            </li>
            <li>
              All settlement frames, bounding boxes, confidence scores, and detection metadata are
              recorded and available in the{' '}
              <Link href="/transparency" className="text-indigo-400 hover:text-indigo-300">
                Transparency Log
              </Link>{' '}
              for auditing.
            </li>
            <li>
              In the event of a technical failure, disputed detection, or stream interruption,
              Arena reserves the right to cancel a round and refund all bets.
            </li>
            <li>
              If you believe a settlement was incorrect, you may file a dispute within 24 hours.
              Disputes are reviewed and resolved at the platform&apos;s discretion.
            </li>
          </ul>
        </section>

        {/* Cryptocurrency */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-3">7. Deposits &amp; Withdrawals</h2>
          <ul className="list-disc list-inside text-sm text-gray-400 space-y-2">
            <li>
              Deposits are accepted in BTC, ETH, and USDT. All deposits are converted to USD at the
              prevailing market rate at the time of deposit confirmation.
            </li>
            <li>
              Internal balances are denominated in USD. Withdrawals are converted back to your
              chosen cryptocurrency at the prevailing rate.
            </li>
            <li>
              Cryptocurrency transactions are irreversible. Always verify addresses before sending.
            </li>
            <li>
              Blockchain network fees are deducted from withdrawal amounts. Minimum and maximum
              deposit/withdrawal limits may apply.
            </li>
            <li>
              Arena reserves the right to delay or refuse withdrawals pending identity verification
              or fraud investigation.
            </li>
          </ul>
        </section>

        {/* Account */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-3">8. Account Security</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            You are responsible for maintaining the confidentiality of your account credentials.
            All bets placed from your account are your responsibility. Arena will not reverse bets
            placed by unauthorized users if your credentials were compromised due to your negligence.
            Do not share your password with anyone.
          </p>
        </section>

        {/* Limitation of liability */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-3">9. Limitation of Liability</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Arena is provided &ldquo;as is&rdquo; without warranty of any kind, express or implied.
            To the maximum extent permitted by law, Arena shall not be liable for any direct, indirect,
            incidental, special, consequential, or punitive damages arising from your use of the
            platform, including but not limited to loss of funds, interrupted service, or technical errors.
          </p>
        </section>

        {/* Modifications */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-white mb-3">10. Modifications</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            We reserve the right to modify these terms at any time. Continued use of the platform
            after changes are posted constitutes acceptance of the modified terms. We will make
            reasonable efforts to notify users of material changes via email or platform notification.
          </p>
        </section>

        <p className="text-xs text-gray-600 text-center pt-4 border-t border-gray-800">
          Last updated: April 2026. If you have questions about these terms, contact support@arena.bet.
        </p>
      </div>
    </div>
  );
}
