import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Icon, type IconName } from './icons';

const TABS: { to: string; label: string; icon: IconName; match: (path: string) => boolean }[] = [
  {
    to: '/',
    label: 'Предметы',
    icon: 'book',
    match: (path) =>
      path === '/' ||
      path.startsWith('/subject') ||
      path.startsWith('/activity') ||
      path.startsWith('/session'),
  },
  {
    to: '/groups',
    label: 'Группы',
    icon: 'users',
    match: (path) => path.startsWith('/groups') || path.startsWith('/students'),
  },
  { to: '/stats', label: 'Статистика', icon: 'chart', match: (path) => path.startsWith('/stats') },
  {
    to: '/settings',
    label: 'Настройки',
    icon: 'settings',
    match: (path) =>
      path.startsWith('/settings') || path.startsWith('/data') || path.startsWith('/transfer'),
  },
];

export function AppShell() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-app flex-col bg-bg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-[13px] focus:text-surface"
      >
        К содержанию
      </a>
      <main id="main-content" className="pad-above-nav flex-1">
        <div key={location.pathname} className="page-enter">
          <Outlet />
        </div>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-app border-t border-line bg-surface safe-bottom">
        <div className="grid grid-cols-4">
          {TABS.map((tab) => {
            const active = tab.match(location.pathname);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`relative flex h-[62px] flex-col items-center justify-center gap-1 text-[11px] transition-colors duration-150 focus-ring ${
                  active ? 'font-semibold text-ink' : 'font-normal text-faint'
                }`}
              >
                {active ? (
                  <span aria-hidden="true" className="absolute inset-x-5 top-0 h-[2px] rounded-b bg-clay" />
                ) : null}
                <Icon name={tab.icon} size={21} strokeWidth={active ? 2 : 1.7} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
