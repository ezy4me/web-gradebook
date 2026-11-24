import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../components/Page';
import { Button, FullPageLoader } from '../components/ui';
import { Icon } from '../components/icons';
import { supabaseConfigured } from '../sync/config';

/** Завершение входа после редиректа из Edge Function: token_hash → сессия. */
export function AuthScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tokenHash = params.get('token_hash');
  const started = useRef(false);
  const [state, setState] = useState<'working' | 'error' | 'missing'>('working');
  const [message, setMessage] = useState('Завершаем вход через Яндекс ID…');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!supabaseConfigured) {
      setState('error');
      setMessage('Supabase не настроен: задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.');
      return;
    }
    if (!tokenHash) {
      setState('missing');
      setMessage('В ссылке нет токена входа. Вернитесь в настройки и попробуйте снова.');
      return;
    }
    void (async () => {
      try {
        const { supabase } = await import('../sync/supabase');
        if (!supabase) throw new Error('Supabase не настроен');
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
        if (error) {
          setState('error');
          setMessage(error.message);
          return;
        }
        navigate('/', { replace: true });
      } catch (error) {
        setState('error');
        setMessage(error instanceof Error ? error.message : 'Не удалось завершить вход');
      }
    })();
  }, [navigate, tokenHash]);

  if (state === 'working') {
    return (
      <Page title="Вход" subtitle="Яндекс ID">
        <div className="flex flex-col items-center gap-4 py-16">
          <FullPageLoader label={message} />
        </div>
      </Page>
    );
  }

  return (
    <Page title="Вход" subtitle="Яндекс ID" back backTo="/settings">
      <div className="mt-6 rounded-card border border-line bg-surface p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger-soft text-danger">
          <Icon name="alert" size={22} />
        </div>
        <p className="mt-4 text-[15px] font-medium text-ink">Вход не завершён</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{message}</p>
        <Button full className="mt-5" onClick={() => navigate('/settings', { replace: true })}>
          Вернуться в настройки
        </Button>
      </div>
    </Page>
  );
}
