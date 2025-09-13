// src/timeline.js
import { DateTime } from 'luxon';
import { getUpcomingEvents } from './service.js';

function colorBySource(source) {
  // QuickChart 기본 팔레트 사용 (명시 색상 없어도 되지만 구분을 위해 지정)
  const m = { fed: 'rgba(54,162,235,0.9)', ecb: 'rgba(255,159,64,0.9)', boe: 'rgba(75,192,192,0.9)' };
  return m[source] || 'rgba(201, 203, 207, 0.9)';
}

export function buildTimelineChartUrl(events, days = 7) {
  // 라벨: "[FED] Title • 09-15 23:00 KST"
  const labels = events.map(ev => {
    const kst = DateTime.fromISO(ev.start_utc, { zone: 'utc' }).setZone('Asia/Seoul').toFormat('MM-dd HH:mm');
    const src = (ev.source || '').toUpperCase();
    const title = (ev.title || '').slice(0, 60) + ((ev.title || '').length > 60 ? '…' : '');
    return `[${src}] ${title} • ${kst} KST`;
  });

  // 가로 막대처럼 보이게: 시작~시작+30분 구간
  const datasets = [
    {
      label: `Upcoming ${days} days`,
      data: events.map(ev => {
        const start = DateTime.fromISO(ev.start_utc, { zone: 'utc' }).toISO();
        const end = DateTime.fromISO(ev.start_utc, { zone: 'utc' }).plus({ minutes: 30 }).toISO();
        return { x: [start, end] };
      }),
      parsing: { xAxisKey: 'x' },
      borderWidth: 1,
      backgroundColor: events.map(ev => colorBySource(ev.source)),
      borderColor: events.map(ev => colorBySource(ev.source))
    }
  ];

  const minX = DateTime.now().setZone('Asia/Seoul').startOf('day'); // 오늘 00:00 KST
  const maxX = minX.plus({ days });

  const config = {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: `Upcoming ${days} Days — KST` },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          type: 'time',
          min: minX.toISO(),
          max: maxX.toISO(),
          time: { unit: 'day', tooltipFormat: 'MMM d HH:mm' },
          ticks: { maxTicksLimit: days + 1 }
        },
        y: { ticks: { autoSkip: false } }
      },
      barThickness: 8
    }
  };

  const base = 'https://quickchart.io/chart';
  const params = new URLSearchParams({
    c: JSON.stringify(config),
    width: '1000',
    height: '600',
    format: 'png',
    backgroundColor: 'white'
  });
  return `${base}?${params.toString()}`;
}

export function getTimelineChartUrlForNextDays(days = 7, limit = 20) {
  const hours = days * 24;
  const events = getUpcomingEvents(hours).slice(0, limit);
  if (!events.length) return null;
  return buildTimelineChartUrl(events, days);
}
