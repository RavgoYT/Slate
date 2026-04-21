//main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Initialize theme before rendering
const initTheme = () => {
    const stored = localStorage.getItem('theme') || 'dark';
    if (stored === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', stored);
    }
};

initTheme();

const container = document.getElementById('app');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);