import { useEffect, useRef, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LockScreen } from './components/LockScreen';
import { ToastProvider } from './components/ui';
import { applyTheme, getSettings, useSettings, watchSystemTheme } from './lib/settings';
import { SubjectsScreen } from './screens/SubjectsScreen';
import { GroupsScreen } from './screens/GroupsScreen';
import { GroupScreen } from './screens/GroupScreen';
import { StudentProfileScreen } from './screens/StudentProfileScreen';
import { SubjectScreen } from './screens/SubjectScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { SessionScreen } from './screens/SessionScreen';
import { StudentScreen } from './screens/StudentScreen';
import { StatsScreen } from './screens/StatsScreen';
import { DataScreen } from './screens/DataScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AuthScreen } from './screens/AuthScreen';
import { TransferScreen } from './screens/TransferScreen';

export default function App() {
  const settings = useSettings();
  const [locked, setLocked] = useState(() => Boolean(getSettings().pinHash));
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => watchSystemTheme(), []);

  useEffect(() => {
    if (!settings.pinHash) setLocked(false);
  }, [settings.pinHash]);

  useEffect(() => {
    if (!settings.pinHash) return;
    const bump = () => {
      lastActivity.current = Date.now();
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const event of events) window.addEventListener(event, bump, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') bump();
    });
    const timer = window.setInterval(() => {
      const timeout = Math.max(1, settings.autoLockMinutes) * 60_000;
      if (Date.now() - lastActivity.current >= timeout) setLocked(true);
    }, 5_000);
    return () => {
      for (const event of events) window.removeEventListener(event, bump);
      window.clearInterval(timer);
    };
  }, [settings.pinHash, settings.autoLockMinutes]);

  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<SubjectsScreen />} />
            <Route path="/groups" element={<GroupsScreen />} />
            <Route path="/groups/:groupId" element={<GroupScreen />} />
            <Route path="/students/:studentId" element={<StudentProfileScreen />} />
            <Route path="/stats" element={<StatsScreen />} />
            <Route path="/data" element={<DataScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/auth" element={<AuthScreen />} />
            <Route path="/transfer" element={<TransferScreen />} />
            <Route path="/subject/:subjectId" element={<SubjectScreen />} />
            <Route path="/subject/:subjectId/student/:studentId" element={<StudentScreen />} />
            <Route path="/activity/:activityId" element={<ActivityScreen />} />
            <Route path="/session/:sessionId" element={<SessionScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
      {locked ? (
        <LockScreen
          onUnlock={() => {
            lastActivity.current = Date.now();
            setLocked(false);
          }}
        />
      ) : null}
    </ToastProvider>
  );
}
