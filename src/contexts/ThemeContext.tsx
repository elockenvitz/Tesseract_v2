import React, { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

// Bumped from 'tesseract-theme'. The previous version seeded itself from
// prefers-color-scheme and then persisted that value, so every user on a
// dark-mode OS ended up with 'dark' saved without ever choosing it. Reading a
// new key resets those users once; only a deliberate toggle persists from here.
const THEME_STORAGE_KEY = 'tesseract-theme-v2'
const LEGACY_THEME_STORAGE_KEY = 'tesseract-theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') {
      return saved as Theme
    }
    // Deliberately NOT falling back to prefers-color-scheme. Dark mode is only
    // partially implemented across the app, so inferring it from the OS opted
    // users into a half-styled theme they never asked for — light cards on a
    // dark page and vice versa. Dark is opt-in via the toggle until coverage
    // is complete; at that point this can go back to honouring the OS.
    return 'light'
  })

  // Drop the stale key so it can't be resurrected by older code paths.
  useEffect(() => {
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY)
  }, [])

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme)

    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}