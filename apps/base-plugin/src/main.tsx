import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// This Vite entry is a standalone preview, not the installable Feishu plugin.
createRoot(document.getElementById('root')!).render(<App preview />);
