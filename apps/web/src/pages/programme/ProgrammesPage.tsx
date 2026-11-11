import { Landmark, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardCta,
  EmptyState,
  Modal,
  PageHeader,
  Progress,
  Spinner,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatHectares, titleCase } from '../../lib/format';
import { formatNaira, ratio } from '../../lib/money';
import { formatPct, PROGRAMME_KIND, PROGRAMME_STATUS, repaymentRate } from '../../lib/programmes';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { ProgrammeSummary } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { ProgrammeForm } from './ProgrammeForm';

export function ProgrammesPage() {
  const role = useAuth().profile?.role;
  const [creating, setCreating] = useState(false);
  const state = useAsync(async () => {
    const { data, error } = await supabase.rpc('programme_summaries');
    if (error) throw error;
    return data as ProgrammeSummary[];
  }, []);

  return (
    <div>
      <PageHeader
        title="Programmes"
        description="Government and donor input-credit and grant schemes. Each programme sets who qualifies, what they receive and what must come back; its cycles can't be approved unless they fit."
        actions={
          can.manageProgrammes(role) && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New programme
            </Button>
          )
        }
      />
      {state.loading && !state.data ? (
        <Spinner />
      ) : state.error ? (
        <Alert>{errorMessage(state.error)}</Alert>
      ) : state.data!.length === 0 ? (
        <EmptyState icon={<Landmark />} title="No programmes yet">
          A programme manager designs a programme, then attaches programme-funded cycles to it.
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {state.data!.map((p) => (
            <ProgrammeCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        wide
        title="New programme"
        description="Saved as a draft. Activate it once the terms are final; they can't change after that."
      >
        <ProgrammeForm onDone={() => setCreating(false)} />
      </Modal>
    </div>
  );
}

function ProgrammeCard({ p }: { p: ProgrammeSummary }) {
  const status = PROGRAMME_STATUS[p.status];
  const rate = repaymentRate(p);
  return (
    <Link to={`/programmes/${p.id}`} className="group block focus-visible:outline-none">
      <Card className="h-full transition group-hover:shadow-pop group-focus-visible:ring-2 group-focus-visible:ring-brand-600">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-500">{p.code}</p>
            <h3 className="mt-1 text-lg font-semibold text-zinc-950">{p.name}</h3>
            <p className="text-sm text-zinc-500">{p.sponsor}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{PROGRAMME_KIND[p.kind]}</Badge>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          </div>
        </div>
        <p className="mt-3 text-sm text-zinc-600">
          {p.commodities.map(titleCase).join(', ')} in {p.target_states.join(', ')} ·{' '}
          {formatDate(p.starts_on)} – {formatDate(p.ends_on)}
        </p>
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs text-zinc-500">
            <span>
              <span className="font-medium text-zinc-900">
                {formatNaira(p.committed_kobo, { compact: true })}
              </span>{' '}
              committed
            </span>
            <span>of {formatNaira(p.budget_kobo, { compact: true })} budget</span>
          </div>
          <Progress value={ratio(p.committed_kobo, p.budget_kobo)} />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          {(
            [
              ['Farmers', `${p.farmers.toLocaleString('en-NG')}`],
              ['Hectares', formatHectares(p.hectares)],
              ['Cycles', String(p.cycles)],
              ['Repaid', p.kind === 'grant' ? 'Grant' : formatPct(rate)],
            ] as [string, string][]
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-zinc-500">{label}</dt>
              <dd className="mt-0.5 font-semibold text-zinc-950 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <CardCta>View programme</CardCta>
      </Card>
    </Link>
  );
}
