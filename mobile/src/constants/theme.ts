export const THEME = {
  colors: {
    // Institutional dark background
    background: "#080e14",
    surface: "#0c141b",
    surfaceRaised: "#101b23",
    panel: "#14202a",
    panelRaised: "#192833",
    
    // Lines & dividers
    line: "#2a3943",
    lineStrong: "#43545c",
    lineSubtle: "rgba(42, 57, 67, 0.6)",
    
    // Institutional typography
    text: "#f2f0e9",
    textMuted: "#a5b1b7",
    textFaint: "#70828b",
    
    // Brand accents
    bronze: "#e9bd8c",
    bronzeLight: "#f4d8b8",
    bronzeDark: "#b77d4e",
    verdigris: "#78b9ad",
    verdigrisLight: "#a4d2c9",
    
    // P&L colours (deliberately isolated from brand accent)
    up: "#4fd18b",
    down: "#f07474",
    warning: "#fbbf24",
    info: "#38bdf8",
    
    // Autonomy level badges
    autonomy: {
      RESEARCH: "#64748b",
      SUGGEST: "#38bdf8",
      CONFIRM: "#f59e0b",
      POLICY_AUTO: "#10b981",
      AUTONOMOUS: "#a855f7",
      EMERGENCY_RISK_ONLY: "#ef4444",
    },
    
    // Promotion stages
    stage: {
      DRAFT: "#64748b",
      BACKTEST: "#0284c7",
      STRESS_TEST: "#d97706",
      PAPER: "#10b981",
      SHADOW: "#6366f1",
      LIMITED_LIVE: "#ec4899",
      LIVE: "#22c55e",
      PAUSED: "#f43f5e",
    },
  },
  
  fonts: {
    sans: "System",
    mono: "Courier",
  },
  
  borderRadius: {
    xs: 2,
    sm: 4,
    md: 6,
    lg: 8,
    xl: 12,
    pill: 999,
  },
  
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
};
