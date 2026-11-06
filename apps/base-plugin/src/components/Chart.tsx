import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import type { AnalysisResult } from '../../shared/types';

const palette = ['#7361ed', '#9b8bf4', '#b9acf7', '#cfc6fa', '#537e83', '#8cbbac'];
const tick = { fill: '#89919f', fontSize: 12 };
const format = (value: number) =>
  Math.abs(value) >= 10000 ? `${(value / 10000).toFixed(1)}万` : value.toLocaleString('zh-CN');

export function Chart({ result }: { result: AnalysisResult }) {
  const config = result.chart?.config;
  const type = result.chart?.chartType;
  const raw = Array.isArray(config?.data) ? (config.data as Record<string, unknown>[]) : [];
  const data = raw.map((d) => ({
    category: String(d.category ?? d.time ?? ''),
    value: Number(d.value),
  }));
  const supported =
    ['line', 'area', 'bar', 'column', 'pie'].includes(type ?? '') &&
    data.length > 0 &&
    data.every((d) => Number.isFinite(d.value)) &&
    !raw.some((d) => d.group != null);
  if (!supported) {
    if (!result.chartHtml) return <div className="empty-table">本次结果适合通过数据表查看</div>;
    // AVA emits a fixed HTML template with escaped JSON. Isolate its runtime and deny navigation / parent access.
    const html = result.chartHtml.replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline'; img-src data: blob:; connect-src https://unpkg.com; font-src data:; base-uri 'none'; form-action 'none'">`,
    );
    return (
      <>
        <iframe
          title="AVA 分析图表"
          className="chart-frame"
          sandbox="allow-scripts"
          srcDoc={html}
          referrerPolicy="no-referrer"
        />
        <p className="table-note">
          复杂图表使用 AVA 渲染器，需要访问 unpkg.com；如未显示，可切换至计算结果。
        </p>
      </>
    );
  }
  const tooltip = (
    <Tooltip
      formatter={(value) => [
        Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 }),
        String(config?.axisYTitle ?? '数值'),
      ]}
      contentStyle={{ borderRadius: 10, border: '1px solid #eeeef4', fontSize: 13 }}
      cursor={{ stroke: '#eae8f8' }}
    />
  );
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#eceef2" />
      <XAxis dataKey="category" tick={tick} axisLine={false} tickLine={false} dy={10} />
      <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={format} width={65} />
      {tooltip}
    </>
  );
  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={300} minWidth={0}>
        {type === 'pie' ? (
          <PieChart>
            <Pie
              isAnimationActive={false}
              data={data}
              dataKey="value"
              nameKey="category"
              innerRadius={70}
              outerRadius={110}
              paddingAngle={3}
            >
              {data.map((d, i) => (
                <Cell key={d.category} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            {tooltip}
          </PieChart>
        ) : type === 'line' ? (
          <LineChart data={data} margin={{ top: 15, right: 20, left: 0, bottom: 20 }}>
            {axes}
            <Line
              isAnimationActive={false}
              type="linear"
              dataKey="value"
              stroke={palette[0]}
              strokeWidth={3}
              dot={{ r: 4, fill: '#fff', strokeWidth: 2 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={data} margin={{ top: 15, right: 20, left: 0, bottom: 20 }}>
            {axes}
            <Area
              isAnimationActive={false}
              type="linear"
              dataKey="value"
              fill="#e9e4ff"
              stroke={palette[0]}
              strokeWidth={3}
            />
          </AreaChart>
        ) : type === 'bar' ? (
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 15, right: 35, left: 0, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="#eceef2" />
            <XAxis
              type="number"
              tick={tick}
              tickFormatter={format}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              dataKey="category"
              type="category"
              tick={tick}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            {tooltip}
            <Bar
              isAnimationActive={false}
              dataKey="value"
              fill={palette[0]}
              radius={[0, 5, 5, 0]}
              maxBarSize={32}
            />
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 15, right: 20, left: 0, bottom: 20 }}>
            {axes}
            <Bar
              isAnimationActive={false}
              dataKey="value"
              fill={palette[0]}
              radius={[5, 5, 0, 0]}
              maxBarSize={45}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
      {type === 'pie' && (
        <div className="chart-legend">
          {data.map((d, i) => (
            <span key={d.category}>
              <i style={{ background: palette[i % palette.length] }} />
              {d.category}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
