/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Sidebar.css';
import { useZoomContext } from '../context/ZoomContext.jsx';
import { useProjectData } from '../context/ProjectDataContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { isTauri } from '../lib/projectIo.js';

const MENU = [
  { path: '/', label: 'Map' },
  { path: '/strip-log', label: 'Strip Logs' },
  { path: '/strip-log-advanced', label: 'Advanced Strip Logs' },
  { path: '/drillhole', label: '3D Scene' },
  { path: '/analytics', label: 'Analytics' },
];

function Sidebar() {
  const location = useLocation();
  const { zoomLevel } = useZoomContext();
  const { theme, setTheme } = useTheme();
  const project = useProjectData();
  const folderInputRef = useRef(null);

  const onOpenClick = async () => {
    if (isTauri()) {
      try {
        await project.openProject();
      } catch (e) {
        console.error('openProject failed', e);
      }
    } else {
      folderInputRef.current?.click();
    }
  };

  const onFolderInputChange = async (event) => {
    const files = event.target.files;
    if (!files || !files.length) return;
    try {
      await project.openProjectFromFileList(files);
    } catch (e) {
      console.error('openProjectFromFileList failed', e);
    }
    // Reset so picking the same folder twice still triggers change.
    event.target.value = '';
  };

  const folderLabel = project.folderPath
    ? shortenPath(project.folderPath)
    : 'No project loaded';

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <div className="brand-eyebrow">Darkmine</div>
        <h1 className="brand-title">Baselode Viewer</h1>
        <span className="sidebar-version">v{__APP_VERSION__}</span>
      </div>

      <ul className="sidebar-menu">
        {MENU.map((item) => (
          <li key={item.path}>
            <Link to={item.path} className={location.pathname === item.path ? 'active' : ''}>
              <span className="label">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="sidebar-section">
        <div className="label-caps">Project</div>
        <Link
          to="/data-instructions"
          className={`sidebar-section-link${location.pathname === '/data-instructions' ? ' active' : ''}`}
        >
          Data Format Instructions
        </Link>
        <button type="button" className="primary-button sidebar-open-btn" onClick={onOpenClick}>
          {project.status === 'loading' ? 'Loading…' : 'Open project folder'}
        </button>
        <input
          ref={folderInputRef}
          type="file"
          // webkitdirectory & directory let us pick a folder in dev outside Tauri
          webkitdirectory=""
          directory=""
          multiple
          hidden
          onChange={onFolderInputChange}
        />
        <div className="sidebar-folder-path" title={project.folderPath}>{folderLabel}</div>
        {project.status === 'error' && project.errors?.load && (
          <div className="error-banner small">{project.errors.load}</div>
        )}
        {project.status === 'ready' && (
          <button type="button" className="ghost-button small sidebar-close-btn" onClick={project.closeProject}>
            Close
          </button>
        )}
      </div>

      <div id="map-controls-slot" className="sidebar-slot" />
      <div id="strip-log-controls-slot" className="sidebar-slot" />
      <div id="three-d-controls-slot" className="sidebar-slot" />

      <div className="sidebar-footer">
        <div id="data-source-slot" className="data-source-info" />
        {location.pathname === '/' && project.status === 'ready' && (
          <span className="zoom-label">Zoom: {Number(zoomLevel).toFixed(2)}</span>
        )}
      </div>

      <div className="sidebar-footer-actions">
        <div className="theme-toggle" role="group" aria-label="Theme">
          <button
            type="button"
            className={`theme-toggle-btn${theme === 'light' ? ' active' : ''}`}
            onClick={() => setTheme('light')}
            aria-pressed={theme === 'light'}
            aria-label="Light theme"
            title="Light theme"
          >
            <SunIcon />
          </button>
          <button
            type="button"
            className={`theme-toggle-btn${theme === 'dark' ? ' active' : ''}`}
            onClick={() => setTheme('dark')}
            aria-pressed={theme === 'dark'}
            aria-label="Dark theme"
            title="Dark theme"
          >
            <MoonIcon />
          </button>
        </div>
        <a href="https://darkmine.ai" target="_blank" rel="noopener noreferrer" className="source-link">
          Darkmine
        </a>
        <a href="https://github.com/darkmine-oss/baselode-frontend" target="_blank" rel="noopener noreferrer" className="source-link">
          baselode-frontend source
        </a>
        <a href="https://github.com/darkmine-oss/baselode" target="_blank" rel="noopener noreferrer" className="source-link">
          baselode source v{__BASELODE_VERSION__}
        </a>
      </div>
    </nav>
  );
}

function shortenPath(p) {
  if (!p) return '';
  if (p.length <= 36) return p;
  const head = p.slice(0, 12);
  const tail = p.slice(-20);
  return `${head}…${tail}`;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.93 4.93l1.41 1.41" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M4.93 19.07l1.41-1.41" />
      <path d="M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default Sidebar;
