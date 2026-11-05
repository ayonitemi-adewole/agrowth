import { CYCLE_STATUS, MILESTONE_STATUS } from '../lib/cycles';
import type { CycleStatus, MilestoneStatus } from '../lib/types';
import { Badge } from './ui';

export function CycleStatusBadge({ status }: { status: CycleStatus }) {
  const s = CYCLE_STATUS[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  const s = MILESTONE_STATUS[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}
