// The pages' fonts, served from the site instead of Google Fonts, so a visitor's browser asks no third party for them
// (#75). Barlow draws running text and Barlow Condensed the headings, buttons, the HUD and the map's labels. Latin
// subsets only: they cover Swedish (å ä ö) and every name in the game. A browser downloads only the weights a page
// draws with, and the files stay beside the page instead of being inlined into it (vite.config.ts).
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
