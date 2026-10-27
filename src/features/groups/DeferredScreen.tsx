import { memo, useState } from 'react';
import type { ReactNode } from 'react';

export const DeferredScreen = memo(function DeferredScreen({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return active || visited ? children : null;
}, (previous, next) => !previous.active && !next.active);
