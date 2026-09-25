import { Outlet } from 'react-router-dom';
import { ConfigDropdown } from './ConfigDropdown';
import { Sidebar } from './Sidebar';

/**
 * ShellDesktop — desktop chrome around <Outlet/>.
 * Extracted from AppLayout (§5 #1). Owns Sidebar + top-bar ConfigDropdown.
 */
export function ShellDesktop() {
  return (
    <div className="app">
      <Sidebar />
      <div className="main-content">
        <div className="top-bar">
          <ConfigDropdown />
        </div>
        <Outlet />
      </div>
    </div>
  );
}
