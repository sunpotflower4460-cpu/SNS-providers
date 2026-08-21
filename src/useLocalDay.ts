import { useEffect, useState } from 'react';

export function useLocalDayKey() {
  const [dayKey, setDayKey] = useState(() => localDayKey(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNextBoundary = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 1, 0);
      const delay = Math.max(1_000, next.getTime() - now.getTime());
      timer = setTimeout(() => {
        setDayKey(localDayKey(new Date()));
        scheduleNextBoundary();
      }, delay);
    };

    scheduleNextBoundary();
    const refreshAfterVisibility = () => {
      if (document.visibilityState === 'visible') setDayKey(localDayKey(new Date()));
    };
    document.addEventListener('visibilitychange', refreshAfterVisibility);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshAfterVisibility);
    };
  }, []);

  return dayKey;
}

export function localDayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
