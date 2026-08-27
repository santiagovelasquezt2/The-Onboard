import styles from './NavBar.module.css'

export function NavBar() {
  return (
    <header className={styles.nav}>
      <div className={styles.brand}>TheOnboard</div>
      <div className={styles.meta}>Russell · Montréal Q3 · 1:12.000</div>
    </header>
  )
}
