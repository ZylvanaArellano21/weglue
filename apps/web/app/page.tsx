import Image from "next/image";
import Link from "next/link";

function NavBar() {
  return (
    <nav className="sticky top-0 z-50 bg-[#FEFCF0]/90 backdrop-blur-sm border-b border-black/5">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="We Glue" width={28} height={28} />
          <span className="font-bold text-base text-black" style={{ fontFamily: "var(--font-zain)" }}>
            We Glue
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-8">
          <a href="#vision" className="text-sm text-black hover:text-[#0FA6A6] transition-colors">
            Our Vision
          </a>
          <a href="#how" className="text-sm text-black hover:text-[#0FA6A6] transition-colors">
            How it Works?
          </a>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-semibold text-black hover:text-[#0FA6A6] transition-colors"
          >
            Log In
          </Link>
          <Link
            href="/get-started"
            className="bg-[#0FA6A6] text-white text-sm font-semibold px-4 py-2 rounded-full hover:bg-[#0d9494] transition-colors"
          >
            Download App
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="bg-[#FEFCF0] border-t border-black/10 pt-10 pb-6">
      <div className="max-w-5xl mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between gap-8 mb-8">
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2 mb-3">
              <Image src="/logo.png" alt="We Glue" width={32} height={32} />
              <span
                className="font-bold text-lg text-black"
                style={{ fontFamily: "var(--font-zain)" }}
              >
                We Glue
              </span>
            </Link>
            <p className="text-xs text-[#5F5D5D] leading-relaxed">
              Connecting you with clubs and communities that match your passions.
              Find your people, join your club.
            </p>
            <div className="flex gap-3 mt-4">
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="w-8 h-8 rounded-full border border-black/15 flex items-center justify-center text-black hover:border-[#0FA6A6] hover:text-[#0FA6A6] transition-colors text-sm font-bold"
              >
                IG
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="LinkedIn"
                className="w-8 h-8 rounded-full border border-black/15 flex items-center justify-center text-black hover:border-[#0FA6A6] hover:text-[#0FA6A6] transition-colors text-sm font-bold"
              >
                in
              </a>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-black uppercase tracking-wide mb-1">Legal</p>
            <Link href="/privacy-policy" className="text-xs text-[#5F5D5D] hover:text-[#0FA6A6]">
              Privacy Policy
            </Link>
            <Link href="/terms-of-service" className="text-xs text-[#5F5D5D] hover:text-[#0FA6A6]">
              Terms of Service
            </Link>
            <Link href="/login" className="text-xs text-[#5F5D5D] hover:text-[#0FA6A6]">
              Contact Us
            </Link>
          </div>
          <div>
            <Link
              href="/get-started"
              className="bg-[#0FA6A6] text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-[#0d9494] transition-colors"
            >
              Download App
            </Link>
          </div>
        </div>
        <p className="text-[10px] text-[#5F5D5D] text-center border-t border-black/10 pt-4">
          © {new Date().getFullYear()} We Glue. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

const FEATURES = [
  {
    icon: "♥",
    title: "Instant club discovery",
    description: "Get match with the ones you will actually love",
  },
  {
    icon: "📅",
    title: "Never miss an event",
    description: "Stay on top of events, meetings, and activities going on",
  },
  {
    icon: "👥",
    title: "Stay connected",
    description: "Find out if they are going to an event & grow your community",
  },
  {
    icon: "✓",
    title: "ALL in one place",
    description: "Your feed, your events, your friends. No more switching between apps",
  },
];

export default function LandingPage(): JSX.Element | null {
  return (
    <div className="min-h-screen bg-[#FEFCF0]">
      <NavBar />

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-8 text-center">
        <h1
          className="text-4xl md:text-5xl font-bold text-black leading-tight mb-2"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          Find Your People.
        </h1>
        <h2
          className="text-4xl md:text-5xl font-bold text-[#0FA6A6] leading-tight mb-5"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          Join Your Club.
        </h2>
        <p className="text-sm md:text-base text-[#5F5D5D] max-w-md mx-auto leading-relaxed mb-8">
          College is more fun when you belong somewhere. We Glue helps you find
          your clubs, your community, and your people.
        </p>
        <Link
          href="/get-started"
          className="inline-flex items-center justify-center bg-[#0FA6A6] text-white font-semibold text-base px-10 py-3.5 rounded-full hover:bg-[#0d9494] transition-colors shadow-md"
        >
          Get Started
        </Link>
      </section>

      {/* Hero image */}
      <section className="max-w-5xl mx-auto px-6 py-8 flex justify-center">
        <div className="relative w-full max-w-3xl">
          <Image
            src="/landing-hero.png"
            alt="We Glue app preview"
            width={960}
            height={640}
            className="w-full h-auto object-contain"
            priority
          />
        </div>
      </section>

      {/* Vision / Quote */}
      <section id="vision" className="bg-[#FEFCF0] py-16 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-12">
          <blockquote
            className="text-3xl md:text-4xl font-bold text-black leading-snug md:w-1/2"
            style={{ fontFamily: "var(--font-zain)" }}
          >
            &ldquo;We believe everyone deserves a community where they truly
            belong.&rdquo;
          </blockquote>
          <div className="md:w-1/2 bg-white rounded-2xl shadow-sm border border-black/5 p-6">
            <p className="text-sm text-black mb-3">
              Are you introvert? Extrovert?
              <br />
              Always asking who is going to an event?
            </p>
            <p className="text-sm text-black mb-3">
              Are you into.. art, history, sports, meeting people, business,
              chess, fashion!!!! Sooo many options.
            </p>
            <p className="text-sm font-bold text-black">
              If YES. <span className="text-[#0FA6A6]">We Glue is for you.</span>
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="how" className="py-16 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 bg-[#E0F7F7] rounded-full flex items-center justify-center text-xl text-[#0FA6A6]">
                {f.icon}
              </div>
              <p className="text-sm font-semibold text-black">{f.title}</p>
              <p className="text-xs text-[#5F5D5D] leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA footer section */}
      <section className="py-16 px-6 text-center">
        <h2
          className="text-3xl md:text-4xl font-bold text-black mb-1"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          Your College Journey
        </h2>
        <h3
          className="text-3xl md:text-4xl font-bold text-[#0FA6A6] mb-8"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          Starts Here
        </h3>
        <Link
          href="/get-started"
          className="inline-flex items-center justify-center bg-[#0FA6A6] text-white font-semibold text-base px-10 py-3.5 rounded-full hover:bg-[#0d9494] transition-colors shadow-md"
        >
          Get Started
        </Link>
        <p className="text-xs text-[#5F5D5D] mt-3">*For free :)</p>
      </section>

      <Footer />
    </div>
  );
}
