import { useId, useMemo, useState } from 'react';

export interface LineSeries {
  name: string;
  values: number[];
  color: string;
  dashed?: boolean;
}

interface LineChartProps {
  labels: string[];
  series: LineSeries[];
  selectedIndex: number;
  unit: string;
  target?: number;
  targetLabel?: string;
  min?: number;
  max?: number;
}

interface Tip { x: number; y: number; text: string }

const shortLabel = (label: string) => label === 'Baseline' ? 'Base' : label.replace('Month ', 'M');

export function LineChart({ labels, series, selectedIndex, unit, target, targetLabel = 'Target', min, max }: LineChartProps) {
  const gradientId = useId().replace(/:/g, '');
  const [tip, setTip] = useState<Tip | null>(null);
  const width = 720;
  const height = 265;
  const pad = { left: 54, right: 24, top: 24, bottom: 42 };
  const all = series.flatMap((item) => item.values).concat(target === undefined ? [] : [target]);
  const lo = min ?? Math.floor(Math.min(...all) * 0.9 * 10) / 10;
  const hi = max ?? Math.ceil(Math.max(...all) * 1.08 * 10) / 10;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (i / Math.max(1, labels.length - 1)) * plotW;
  const y = (value: number) => pad.top + (1 - (value - lo) / Math.max(0.001, hi - lo)) * plotH;
  const ticks = Array.from({ length: 5 }, (_, i) => hi - ((hi - lo) * i) / 4);

  return (
    <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Trend chart in ${unit}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#6d4fc2" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#6d4fc2" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="grid-line" />
            <text x={pad.left - 10} y={y(tick) + 4} textAnchor="end" className="axis-text">{tick.toFixed(tick < 10 ? 1 : 0)}</text>
          </g>
        ))}
        <rect x={x(selectedIndex) - 21} y={pad.top} width="42" height={plotH} rx="8" className="selected-band" />
        {target !== undefined && (
          <g>
            <line x1={pad.left} x2={width - pad.right} y1={y(target)} y2={y(target)} className="target-line" />
            <text x={width - pad.right} y={y(target) - 7} textAnchor="end" className="target-text">{targetLabel}: {target}{unit}</text>
          </g>
        )}
        {series.map((item, seriesIndex) => {
          const points = item.values.map((value, i) => `${x(i)},${y(value)}`).join(' ');
          const area = seriesIndex === 0 ? `${x(0)},${y(lo)} ${points} ${x(item.values.length - 1)},${y(lo)}` : '';
          return (
            <g key={item.name}>
              {area && <polygon points={area} fill={`url(#${gradientId})`} />}
              <polyline points={points} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={item.dashed ? '7 7' : undefined} />
              {item.values.map((value, i) => (
                <circle
                  key={`${item.name}-${i}`}
                  cx={x(i)} cy={y(value)} r={i === selectedIndex ? 6 : 4}
                  fill="#fff" stroke={item.color} strokeWidth={i === selectedIndex ? 3 : 2}
                  tabIndex={0}
                  onMouseEnter={() => setTip({ x: x(i), y: y(value), text: `${labels[i]} · ${item.name}: ${value.toFixed(value < 10 ? 2 : 1)}${unit}` })}
                  onFocus={() => setTip({ x: x(i), y: y(value), text: `${labels[i]} · ${item.name}: ${value.toFixed(value < 10 ? 2 : 1)}${unit}` })}
                >
                  <title>{labels[i]} — {item.name}: {value.toFixed(2)}{unit}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {labels.map((label, i) => (
          <text key={label} x={x(i)} y={height - 14} textAnchor="middle" className={i === selectedIndex ? 'axis-text selected' : 'axis-text'}>{shortLabel(label)}</text>
        ))}
      </svg>
      {tip && <div className="chart-tip" style={{ left: `${(tip.x / width) * 100}%`, top: `${(tip.y / height) * 100}%` }}>{tip.text}</div>}
      <div className="legend" aria-label="Chart legend">
        {series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}
        {target !== undefined && <span><i className="target-key" />{targetLabel}</span>}
      </div>
    </div>
  );
}

interface BarDatum { label: string; current: number; baseline: number }

export function HorizontalBarChart({ data, unit }: { data: BarDatum[]; unit: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const width = 720;
  const height = 265;
  const pad = { left: 116, right: 34, top: 27, bottom: 38 };
  const plotW = width - pad.left - pad.right;
  const max = useMemo(() => Math.ceil(Math.max(...data.flatMap((d) => [d.current, d.baseline])) + 1), [data]);
  const sx = (v: number) => (v / max) * plotW;

  return (
    <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Payer comparison chart in ${unit}`}>
        {Array.from({ length: max + 1 }, (_, i) => i).map((tick) => (
          <g key={tick}>
            <line x1={pad.left + sx(tick)} x2={pad.left + sx(tick)} y1={pad.top} y2={height - pad.bottom} className="grid-line" />
            <text x={pad.left + sx(tick)} y={height - 13} textAnchor="middle" className="axis-text">{tick}%</text>
          </g>
        ))}
        {data.map((d, i) => {
          const rowY = pad.top + i * 46;
          return (
            <g key={d.label}>
              <text x={pad.left - 12} y={rowY + 22} textAnchor="end" className="bar-label">{d.label}</text>
              <rect x={pad.left} y={rowY + 3} width={sx(d.baseline)} height="12" rx="6" fill="#ded8eb" tabIndex={0}
                onMouseEnter={() => setTip({ x: pad.left + sx(d.baseline), y: rowY + 8, text: `${d.label} · Baseline: ${d.baseline.toFixed(1)}${unit}` })}>
                <title>{d.label} — Baseline: {d.baseline.toFixed(1)}{unit}</title>
              </rect>
              <rect x={pad.left} y={rowY + 19} width={sx(d.current)} height="15" rx="7.5" fill="#6d4fc2" tabIndex={0}
                onMouseEnter={() => setTip({ x: pad.left + sx(d.current), y: rowY + 28, text: `${d.label} · Selected: ${d.current.toFixed(1)}${unit}` })}>
                <title>{d.label} — Selected: {d.current.toFixed(1)}{unit}</title>
              </rect>
              <text x={pad.left + sx(d.current) + 8} y={rowY + 31} className="bar-value">{d.current.toFixed(1)}%</text>
            </g>
          );
        })}
      </svg>
      {tip && <div className="chart-tip" style={{ left: `${(tip.x / width) * 100}%`, top: `${(tip.y / height) * 100}%` }}>{tip.text}</div>}
      <div className="legend"><span><i style={{ background: '#6d4fc2' }} />Selected period</span><span><i style={{ background: '#ded8eb' }} />Baseline</span></div>
    </div>
  );
}
