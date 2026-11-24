import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { IconButton } from './ui';

interface PageProps {
  title: string;
  titleClass?: string;
  subtitle?: ReactNode;
  back?: boolean;
  backTo?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Дополнительный контент под заголовком (например, табы). */
  below?: ReactNode;
  padded?: boolean;
}

export function Page({
  title,
  titleClass = '',
  subtitle,
  back,
  backTo,
  actions,
  children,
  below,
  padded = true,
}: PageProps) {
  const navigate = useNavigate();
  return (
    <div className="min-h-full">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex min-h-[58px] w-full max-w-app items-center gap-1.5 px-3 py-2.5 lg:px-6">
          {back ? (
            <IconButton
              icon="back"
              label="Назад"
              onClick={() => {
                if (backTo) navigate(backTo);
                else navigate(-1);
              }}
              className="-ml-1"
            />
          ) : null}
          <div className="min-w-0 flex-1 px-1">
            <h1
              className={`display truncate text-[22px] leading-[1.15] tracking-tight text-ink ${titleClass}`}
            >
              {title}
            </h1>
            {subtitle ? (
              <div className="mt-0.5 truncate text-[12.5px] leading-tight text-dim">{subtitle}</div>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
        </div>
        {below ? <div className="mx-auto w-full max-w-app px-5 pb-0 lg:px-8">{below}</div> : null}
      </header>
      <div className={`mx-auto w-full max-w-app ${padded ? 'px-5 py-5 lg:px-8' : ''}`}>{children}</div>
    </div>
  );
}
