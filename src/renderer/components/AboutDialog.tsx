import React from 'react';

interface AboutDialogProps {
  version: string;
  onClose: () => void;
}

const GITHUB_URL = 'https://github.com/valmapaura/terminalAi';
const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
const RELEASES_URL = `${GITHUB_URL}/releases/latest`;
const ARCHITECTURE_URL = `${GITHUB_URL}/blob/main/ARCHITECTURE.md`;

export const AboutDialog: React.FC<AboutDialogProps> = ({ version, onClose }) => {
  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="about-header">
          <div className="about-icon">◆</div>
          <h2>OS Assistant</h2>
          <button className="about-close-btn" onClick={onClose} title="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="about-version">v{version}</div>

        <p className="about-description">
          Your AI copilot for the operating system. Execute commands, manage files, and automate tasks through natural language.
        </p>

        <div className="about-details">
          <div className="about-detail-row">
            <span className="about-detail-label">Platform</span>
            <span className="about-detail-value">{navigator.platform}</span>
          </div>
          <div className="about-detail-row">
            <span className="about-detail-label">Electron</span>
            <span className="about-detail-value">{/* Injected at build time */}</span>
          </div>
          <div className="about-detail-row">
            <span className="about-detail-label">License</span>
            <span className="about-detail-value">MIT</span>
          </div>
        </div>

        <div className="about-links">
          <a className="about-link" href={GITHUB_URL} title="GitHub Repository">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </a>
          <a className="about-link" href={LICENSE_URL} title="MIT License">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 1.5A1.5 1.5 0 013.5 0h5.586a1.5 1.5 0 011.06.44l3.415 3.414A1.5 1.5 0 0114 4.914V14.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 14.5V1.5zM3.5 1a.5.5 0 00-.5.5v13a.5.5 0 00.5.5h9a.5.5 0 00.5-.5V4.914a.5.5 0 00-.146-.353l-3.415-3.415A.5.5 0 009.086 1H3.5z" />
              <path d="M4 5.5a.5.5 0 01.5-.5h4a.5.5 0 010 1h-4a.5.5 0 01-.5-.5zM4 8a.5.5 0 01.5-.5h4a.5.5 0 010 1h-4a.5.5 0 01-.5-.5zM4 10.5a.5.5 0 01.5-.5h3a.5.5 0 010 1h-3a.5.5 0 01-.5-.5z" />
            </svg>
            License
          </a>
          <a className="about-link" href={RELEASES_URL} title="Latest Release">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 7.775A2.5 2.5 0 013.5 5.5h.75a.75.75 0 010 1.5H3.5a1 1 0 000 2h.75a.75.75 0 010 1.5H3.5A2.5 2.5 0 011 7.775zM11.5 5.5h2.5a.75.75 0 010 1.5H13v2.5a.75.75 0 01-1.5 0V7h-1a.75.75 0 010-1.5h1z" />
              <path d="M8 12a4 4 0 110-8 4 4 0 010 8zm0-1.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
            </svg>
            Latest Release
          </a>
          <a className="about-link" href={ARCHITECTURE_URL} title="Architecture Docs">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 1.5A1.5 1.5 0 013.5 0h5.586a1.5 1.5 0 011.06.44l3.415 3.414A1.5 1.5 0 0114 4.914V14.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 14.5V1.5zM3.5 1a.5.5 0 00-.5.5v13a.5.5 0 00.5.5h9a.5.5 0 00.5-.5V4.914a.5.5 0 00-.146-.353l-3.415-3.415A.5.5 0 009.086 1H3.5z" />
            </svg>
            Architecture
          </a>
        </div>

        <div className="about-footer">
          <span>Made with ❤️ for developers</span>
          <span className="about-footer-links">
            <a href={`${GITHUB_URL}/blob/main/README.md`}>README</a>
            <span className="about-footer-sep">·</span>
            <a href={`${GITHUB_URL}/issues`}>Issues</a>
          </span>
        </div>
      </div>
    </div>
  );
};
