/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        reachinbox: {
          canvas: '#FFFFFF',
          surface: '#F8F9FA',
          surfaceSubtle: '#F4F5F7',
          border: '#E0E0E0',
          borderLight: '#EEEEEE',
          primary: '#2E7D32',
          primaryHover: '#1B5E20',
          activePill: '#E8F5E9',
          activeText: '#1B5E20',
          badgeAmberBg: '#FFF3E0',
          badgeAmberText: '#E65100',
          badgeSentBg: '#ECEFF1',
          badgeSentText: '#546E7A',
          textPrimary: '#1A1A1A',
          textSecondary: '#757575'
        },
        brand: {
          50: '#f0fdf4',
          100: '#E8F5E9',
          500: '#388E3C',
          600: '#2E7D32',
          700: '#1B5E20',
        }
      }
    },
  },
  plugins: [],
}
