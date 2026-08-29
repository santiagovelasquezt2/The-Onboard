import styles from './LandingPage.module.css'

function FunIcon() {
  return (
    <svg
      aria-hidden="true"
      className={styles.ctaIcon}
      viewBox="0 0 64 64"
    >
      <circle cx="32" cy="32" r="25" />
      <circle className={styles.iconFill} cx="21.5" cy="25" r="2.5" />
      <path className={styles.iconFill} d="m29 23 13 9-13 9Z" />
      <path d="M20 43c6.7 5.3 17.3 5.3 24 0" />
    </svg>
  )
}

function NerdIcon() {
  return (
    <svg
      aria-hidden="true"
      className={styles.ctaIcon}
      viewBox="0 0 64 64"
    >
      <path d="M23 12c-6 0-8 3.5-8 9v5c0 4-2 6-6 6 4 0 6 2 6 6v5c0 5.5 2 9 8 9" />
      <path d="M41 12c6 0 8 3.5 8 9v5c0 4 2 6 6 6-4 0-6 2-6 6v5c0 5.5-2 9-8 9" />
      <path d="m24 35 5-7 5 9 6-10" />
    </svg>
  )
}

export default function LandingPage() {
  return (
    <main className={styles.landing}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroCopy}>
          <h1 className={styles.title} id="landing-title">
            The Onboard
          </h1>
          <p className={styles.subtitle}>
            George Russell · Circuit Gilles Villeneuve · Montreal 2024 ·
            1:12.000
          </p>
        </div>
      </section>

      <section className={styles.reelStrip} aria-label="Montreal pole lap">
        <div className={styles.reels} aria-hidden="true">
          <div className={styles.reel}>
            <video autoPlay loop muted playsInline preload="auto">
              <source src="/media/landing/reel1.mp4" type="video/mp4" />
            </video>
          </div>
          <div className={styles.reel}>
            <video autoPlay loop muted playsInline preload="auto">
              <source src="/media/landing/reel2.mp4" type="video/mp4" />
            </video>
          </div>
          <div className={styles.reel}>
            <video autoPlay loop muted playsInline preload="auto">
              <source src="/media/landing/reel3.mp4" type="video/mp4" />
            </video>
          </div>
        </div>

        <nav className={styles.entryPoints} aria-label="Enter The Onboard">
          <a className={styles.entryLink} href="/replay">
            <FunIcon />
            <span>For Fun</span>
          </a>
          <a className={styles.entryLink} href="/replay">
            <NerdIcon />
            <span>For Nerds</span>
          </a>
        </nav>
      </section>
    </main>
  )
}
