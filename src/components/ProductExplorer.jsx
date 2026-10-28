import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowUpRight, Search, SearchX, Sprout } from 'lucide-react';
import { cn, formatNaira, formatNumber } from '../lib/format';
import { cropEmoji } from '../lib/investments';
import { Badge, EmptyState, Segmented, Select, Skeleton } from './ui';

const RISK_STYLES = {
  low: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  high: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

const SORTS = {
  featured: () => 0,
  roi: (a, b) => (Number(b.expectedROI) || 0) - (Number(a.expectedROI) || 0),
  duration: (a, b) => (Number(a.investmentPeriod) || 0) - (Number(b.investmentPeriod) || 0),
  minimum: (a, b) => (Number(a.minimumInvestment) || 0) - (Number(b.minimumInvestment) || 0),
};

const PAGE_SIZE = 6;

export const ProductCard = ({ product, index = 0 }) => {
  const risk = String(product.riskLevel || '').toLowerCase();
  const open = !product.status || String(product.status).toLowerCase() === 'open';
  const soldOut = Number(product.availableUnits) <= 0;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 6) * 0.04 }}>
      <Link
        to={`/product/${product.id}`}
        state={{ product }}
        className="group flex h-full flex-col rounded-3xl border border-line bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg hover:shadow-black/5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-3xl transition group-hover:scale-105">{cropEmoji(product.name)}</div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {risk && <Badge className={RISK_STYLES[risk] || 'bg-surface-2 text-muted'}>{product.riskLevel} risk</Badge>}
            {(!open || soldOut) && <Badge className="bg-surface-2 text-muted">{soldOut ? 'Sold out' : 'Closed'}</Badge>}
          </div>
        </div>
        <h3 className="mt-4 text-lg font-bold">{product.name}</h3>
        {product.category && <p className="text-xs text-muted">{product.category}</p>}

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-surface-2/70 p-3 text-center">
          <div>
            <p className="text-[11px] text-muted">ROI</p>
            <p className="font-extrabold text-accent">{product.expectedROI}%</p>
          </div>
          <div className="border-x border-line">
            <p className="text-[11px] text-muted">Period</p>
            <p className="font-bold">{product.investmentPeriod} mo</p>
          </div>
          <div>
            <p className="text-[11px] text-muted">Min.</p>
            <p className="truncate font-bold">{formatNaira(product.minimumInvestment, { compact: true })}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted">
            {product.availableUnits !== undefined ? `${formatNumber(product.availableUnits)} units left` : 'Open for investment'}
          </span>
          <span className="flex items-center gap-1 font-semibold text-accent">
            Invest <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </div>
      </Link>
    </motion.div>
  );
};

const ProductExplorer = ({ products, loading, limit }) => {
  const [search, setSearch] = useState('');
  const [risk, setRisk] = useState('all');
  const [sort, setSort] = useState('featured');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const preview = Boolean(limit);

  const riskOptions = useMemo(() => {
    const levels = [...new Set(products.map((p) => String(p.riskLevel || '').toLowerCase()).filter(Boolean))];
    return [{ value: 'all', label: 'All' }, ...levels.map((level) => ({ value: level, label: level[0].toUpperCase() + level.slice(1) }))];
  }, [products]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((p) => !term || p.name.toLowerCase().includes(term) || String(p.category || '').toLowerCase().includes(term))
      .filter((p) => risk === 'all' || String(p.riskLevel || '').toLowerCase() === risk)
      .sort(SORTS[sort]);
  }, [products, search, risk, sort]);

  const shown = filtered.slice(0, preview ? limit : visible);

  return (
    <div>
      {!preview && (
        <div className="mb-4 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setVisible(PAGE_SIZE);
                }}
                placeholder="Search crops or categories…"
                className="h-12 w-full rounded-xl border border-line bg-surface pl-11 pr-4 text-[15px] outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                aria-label="Search investment opportunities"
              />
            </div>
            <Select value={sort} onChange={(e) => setSort(e.target.value)} fieldClassName="sm:w-48" aria-label="Sort opportunities">
              <option value="featured">Featured</option>
              <option value="roi">Highest ROI</option>
              <option value="duration">Shortest period</option>
              <option value="minimum">Lowest minimum</option>
            </Select>
          </div>
          {riskOptions.length > 2 && <Segmented options={riskOptions} value={risk} onChange={setRisk} layoutId="risk-filter" size="sm" className="w-fit max-w-full" />}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: preview ? Math.min(limit, 3) : 3 }, (_, i) => (
            <Skeleton key={i} className="h-60 rounded-3xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line">
          <EmptyState
            icon={products.length ? SearchX : Sprout}
            title={products.length ? 'No matches' : 'No opportunities yet'}
            description={products.length ? 'Try another search term or filter.' : 'New farm cycles are added regularly. Check back soon.'}
          />
        </div>
      ) : (
        <div className={cn('grid gap-4 sm:grid-cols-2', !preview && 'xl:grid-cols-3')}>
          {shown.map((product, i) => (
            <ProductCard key={product.id} product={product} index={i} />
          ))}
        </div>
      )}

      {!preview && visible < filtered.length && (
        <div className="mt-6 flex justify-center">
          <button onClick={() => setVisible((v) => v + PAGE_SIZE)} className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold transition hover:bg-surface-2">
            Show more ({filtered.length - visible} left)
          </button>
        </div>
      )}
    </div>
  );
};

export default ProductExplorer;
