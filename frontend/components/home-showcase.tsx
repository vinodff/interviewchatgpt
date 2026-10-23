import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronDown,
  Code2,
  FileText,
  Folder,
  Lightbulb,
  MessageSquare,
  Mic,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
} from "lucide-react";
import "./home-showcase.css";

const waveform = [
  14, 22, 34, 24, 47, 63, 42, 71, 87, 59, 96, 113, 84, 125, 103, 141,
  118, 154, 131, 107, 147, 120, 97, 134, 112, 85, 106, 73, 94, 65, 81,
  54, 69, 43, 56, 31, 42, 25, 19,
];

function ReplayButton({ name }: { name: string }) {
  return (
    <button
      type="button"
      className="showcase-replay"
      data-showcase-replay
      aria-label={`Replay ${name} animation`}
    >
      <RotateCcw size={14} aria-hidden="true" />
      <span>Replay</span>
    </button>
  );
}

function CodeIllustration() {
  return (
    <div className="showcase-terminal-stage" data-scroll-scene>
      <div className="showcase-terminal" data-showcase-trigger data-scroll-layer="panel">
        <div className="showcase-terminal-bar">
          <span className="showcase-terminal-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>answer.js</span>
          <span>Sample code</span>
        </div>
        <div className="showcase-code-question"><MessageSquare size={14} aria-hidden="true" /> How would you find duplicate values?</div>
        <pre className="showcase-code"><code>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">01</span><span><b>function</b> <strong>findDuplicates</strong>(values) {"{"}</span></span>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">02</span><span>{"  "}<b>const</b> seen = <b>new</b> <strong>Set</strong>();</span></span>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">03</span><span>{"  "}<b>const</b> duplicates = <b>new</b> <strong>Set</strong>();</span></span>
          <span className="showcase-code-line showcase-code-space" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">04</span><span>{" "}</span></span>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">05</span><span>{"  "}<b>for</b> (<b>const</b> value <b>of</b> values) {"{"}</span></span>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">06</span><span>{"    "}<b>if</b> (seen.<strong>has</strong>(value)) {"{"}</span></span>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">07</span><span>{"      "}duplicates.<strong>add</strong>(value);</span></span>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">08</span><span>{"    }"}</span></span>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">09</span><span>{"    "}seen.<strong>add</strong>(value);</span></span>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">10</span><span>{"  }"}</span></span>
          <span className="showcase-code-line showcase-code-space" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">11</span><span>{" "}</span></span>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">12</span><span>{"  "}<b>return</b> [...duplicates];</span></span>
          <span className="showcase-code-line" data-showcase-motion="code-line"><span className="showcase-line-number" aria-hidden="true">13</span><span>{"}"}</span></span>
        </code></pre>
        <div className="showcase-code-insight" data-showcase-motion="answer"><Lightbulb size={17} aria-hidden="true" /><p><strong>Talk through the trade-off.</strong> A set remembers what you’ve seen. Explain the extra memory, too.</p></div>
      </div>
    </div>
  );
}

function MobileIllustration() {
  return (
    <div className="showcase-phone-stage" data-showcase-trigger data-scroll-scene role="group" aria-label="Illustration of a readable mobile interview answer">
      <div className="showcase-orbit-scroll showcase-orbit-scroll-notes" data-scroll-layer="orbit-left" aria-hidden="true"><div className="showcase-orbit showcase-orbit-notes" data-showcase-motion="orbit"><FileText size={26} /><span>Your notes</span></div></div>
      <div className="showcase-orbit-scroll showcase-orbit-scroll-voice" data-scroll-layer="orbit-right" aria-hidden="true"><div className="showcase-orbit showcase-orbit-voice" data-showcase-motion="orbit"><AudioLines size={28} /><span>Your voice</span></div></div>
      <div className="showcase-orbit-scroll showcase-orbit-scroll-reading" data-scroll-layer="orbit-bottom" aria-hidden="true"><div className="showcase-orbit showcase-orbit-reading" data-showcase-motion="orbit"><SlidersHorizontal size={24} /><span>Your pace</span></div></div>
      <div className="showcase-device-scroll" data-scroll-layer="device">
        <div className="showcase-device" data-showcase-motion="phone">
          <div className="showcase-phone-screen">
            <div className="showcase-phone-status" aria-hidden="true"><span>9:41</span><span className="showcase-phone-island" /><span className="showcase-phone-battery" /></div>
            <div className="showcase-phone-brand"><span><AudioLines size={20} /> InterviewWin</span><span className="showcase-phone-menu" aria-hidden="true"><i /><i /><i /></span></div>
            <div className="showcase-phone-session"><span className="showcase-status-dot" /> Sample mobile view <span>LIVE INTERVIEW</span></div>
            <div className="showcase-phone-question"><MessageSquare size={16} aria-hidden="true" /><p>Tell me about a project<br />you’re proud of.</p></div>
            <div className="showcase-phone-answer" data-showcase-motion="answer">
              <span className="showcase-phone-eyebrow"><Sparkles size={12} aria-hidden="true" /> SUGGESTED TALKING POINTS</span>
              <h3>Let your experience<br />lead the answer.</h3>
              <div className="showcase-phone-point"><span>01</span><p>We needed a clearer way to track customer requests.</p></div>
              <div className="showcase-phone-point showcase-phone-highlight"><span>02</span><p>I built a shared dashboard and refined it with the support team.</p></div>
              <div className="showcase-phone-point"><span>03</span><p>I learned to start with the people using the tool.</p></div>
              <div className="showcase-phone-reference"><FileText size={12} aria-hidden="true" /> Customer dashboard · Project notes</div>
            </div>
            <div className="showcase-phone-preferences"><span><SlidersHorizontal size={15} aria-hidden="true" /> Answer options</span><ChevronDown size={14} aria-hidden="true" /></div>
            <div className="showcase-phone-bottom"><span>Sample content</span><span aria-hidden="true">Aa <span>—</span> <span>+</span></span></div>
            <div className="showcase-phone-home" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomeShowcase() {
  return (
    <section className="home-showcase landing-container" id="features" aria-labelledby="showcase-heading">
      <div className="showcase-section-heading" data-reveal>
        <p className="home-kicker">BUILT FOR THE MOMENT YOU NEED IT.</p>
        <h2 id="showcase-heading">Less on your mind.<br /><em>More in your corner.</em></h2>
        <p>From a question out loud to the details that make your answer yours. See how your interview tools come together.</p>
      </div>

      <div className="showcase-grid">
        <article className="showcase-panel showcase-coding" data-showcase="coding" aria-labelledby="showcase-coding-title">
          <div className="showcase-coding-copy">
            <span className="showcase-pill"><Code2 size={16} aria-hidden="true" /> TECHNICAL & CODING</span>
            <h3 id="showcase-coding-title">The approach.<br />The explanation.<br /><em>The code.</em></h3>
            <p>Make technical answers easier to follow with structured explanations and formatted code suggestions, streamed as they’re generated.</p>
            <div className="showcase-coding-steps"><span><Check size={14} aria-hidden="true" /> Explain the idea</span><span><Check size={14} aria-hidden="true" /> Discuss the trade-offs</span></div>
            <div className="showcase-panel-actions"><Link href="/features" className="showcase-text-link">Explore technical answers <ArrowRight size={16} aria-hidden="true" /></Link><ReplayButton name="coding" /></div>
            <small className="showcase-note">Illustrated answer. Review code before use.</small>
          </div>
          <CodeIllustration />
        </article>

        <article className="showcase-panel showcase-speech" data-showcase="speech" aria-labelledby="showcase-speech-title">
          <div className="showcase-card-top"><span className="showcase-pill"><AudioLines size={16} aria-hidden="true" /> SPEECH RECOGNITION</span><ReplayButton name="speech" /></div>
          <div className="showcase-speech-visual" data-showcase-trigger data-scroll-scene>
            <div className="showcase-wave-scroll" data-scroll-layer="wave" aria-hidden="true"><div className="showcase-waveform">{waveform.map((height, index) => <i key={index} data-showcase-motion="wave" style={{ height: `${height}px` }} />)}</div></div>
            <div className="showcase-mic-circle" aria-hidden="true"><Mic size={22} /></div>
            <p className="showcase-transcript"><span data-showcase-motion="transcript">“Walk me through</span>{" "}<span data-showcase-motion="transcript">a project</span>{" "}<span data-showcase-motion="transcript">you’re proud of.”</span></p>
            <span className="showcase-visual-caption"><span className="showcase-status-dot" /> Illustrated transcript</span>
          </div>
          <div className="showcase-card-copy"><h3 id="showcase-speech-title">A spoken question.<br /><em>A clear place to start.</em></h3><p>Turn microphone audio into text so live suggestions can follow the conversation. Capture starts when you’re ready and everyone has agreed.</p></div>
        </article>

        <article className="showcase-panel showcase-context" data-showcase="context" aria-labelledby="showcase-context-title">
          <div className="showcase-card-top"><span className="showcase-pill"><Sparkles size={16} aria-hidden="true" /> CONTEXT THAT MATTERS</span><ReplayButton name="context" /></div>
          <div className="showcase-context-visual" data-showcase-trigger data-scroll-scene role="group" aria-label="Resume, project notes, and target role informing a suggested answer">
            <div className="showcase-source-nodes">
              <div className="showcase-source-scroll" data-scroll-layer="source"><div className="showcase-source-node" data-showcase-motion="node"><span><FileText size={23} aria-hidden="true" /></span><p>Your resume</p></div></div>
              <div className="showcase-source-scroll" data-scroll-layer="source"><div className="showcase-source-node" data-showcase-motion="node"><span><Folder size={23} aria-hidden="true" /></span><p>Your projects</p></div></div>
              <div className="showcase-source-scroll" data-scroll-layer="source"><div className="showcase-source-node" data-showcase-motion="node"><span><MessageSquare size={23} aria-hidden="true" /></span><p>Your role</p></div></div>
            </div>
            <svg className="showcase-branches" viewBox="0 0 400 95" fill="none" aria-hidden="true">
              <path pathLength="1" data-showcase-motion="connector" d="M67 1 V19 C67 48 200 42 200 76 V94" />
              <path pathLength="1" data-showcase-motion="connector" d="M200 1 V94" />
              <path pathLength="1" data-showcase-motion="connector" d="M333 1 V19 C333 48 200 42 200 76 V94" />
            </svg>
            <div className="showcase-answer-scroll" data-scroll-layer="context-answer"><div className="showcase-grounded-answer" data-showcase-motion="answer"><span><Sparkles size={15} aria-hidden="true" /> GROUNDED IN YOUR EXPERIENCE</span><p>“I built the dashboard and worked with the support team to refine it.”</p><small><FileText size={12} aria-hidden="true" /> Project notes <CheckCheck size={15} aria-hidden="true" /></small></div></div>
          </div>
          <div className="showcase-card-copy"><h3 id="showcase-context-title">Your story.<br /><em>Woven into the answer.</em></h3><p>Bring your resume, project notes, and target role together. Check source references to keep the details connected to your actual experience.</p></div>
        </article>


      </div>
      <div className="showcase-section-bottom"><p><Sparkles size={16} aria-hidden="true" /> Illustrations use sample content. Your interview uses your own context.</p><Link href="/features">Explore all features <ArrowRight size={16} aria-hidden="true" /></Link></div>
    </section>
  );
}

export function MobileShowcase() {
  return (
        <section className="showcase-panel showcase-mobile home-product-first" data-showcase="mobile" aria-labelledby="showcase-mobile-title">
          <div className="showcase-mobile-copy"><span className="showcase-pill"><Smartphone size={16} aria-hidden="true" /> MADE TO MOVE WITH YOU</span><h2 id="showcase-mobile-title">A smaller screen.<br /><em>The same clarity.</em></h2><p>A focused answer view that feels at home on your phone. Your words have room to breathe, and the controls stay within reach.</p><ul className="showcase-mobile-benefits"><li><span><SlidersHorizontal size={18} aria-hidden="true" /></span><div><strong>Read your way.</strong><p>Adjust text size, font, theme, and reading pace.</p></div></li><li><span><ArrowDown size={18} aria-hidden="true" /></span><div><strong>Keep the answer in view.</strong><p>Separate answer and control areas on mobile.</p></div></li></ul><div className="showcase-panel-actions"><Link href="/interview?view=live" className="button button-primary">Start live interview <ArrowRight size={17} aria-hidden="true" /></Link><ReplayButton name="mobile" /></div><small className="showcase-note">Browser experience. Audio capture depends on your device and permissions.</small></div>
          <MobileIllustration />
        </section>
  );
}

