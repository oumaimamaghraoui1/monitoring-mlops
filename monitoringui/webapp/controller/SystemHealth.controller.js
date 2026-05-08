sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("pwc.monitoring.monitoringui.controller.SystemHealth", {

    onInit: function () {
      this._storageKey = "pwc.monitoring.systemHealth.events.v1";

      const persistedEvents = this._loadPersistedEvents();

      const oModel = new JSONModel({
        events: persistedEvents,
        operations: {
          incidentsToday: 0,
          alertsTriggered: persistedEvents.length,
          lastAnomalyText: persistedEvents.length ? persistedEvents[0].timestamp : "No anomaly yet",
          incidentStreak: 0
        }
      });
      this.getView().setModel(oModel, "metrics");

      this._cpuHistory = [];
      this._memHistory = [];
      this._healthHistory = [];
      this._respHistory = [];
      this._lagHistory = [];
      this._gcHistory = [];
      this._heapHistory = [];
      this._uptimeHistory = [];
      this._maxHistoryPoints = 40;

      this._recentEvents = persistedEvents;
      this._maxRecentEvents = 200;
      this._lastIncidentSignature = "";
      this._currentIncidentStreak = 0;
      this._alertsTriggered = persistedEvents.length;
      this._incidentDayKey = this._getTodayKey();
      this._incidentsToday = this._countTodayIncidents(persistedEvents);

      this._interval = setInterval(function () {
        this.onRefresh();
      }.bind(this), 3000);

      this.onRefresh();
    },

    onAfterRendering: function () {
      this._renderCpuGauge();
      this._renderMemoryTrend();
      this._renderHealthScoreChart();
      this._renderResponseTimeChart();
      this._renderLagChart();
      this._renderGcChart();
      this._renderHeapChart();
      this._renderUptimeChart();
      this._renderCauseDistributionChart();
    },

    onRefresh: function () {
      const BACKEND = "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

      fetch(BACKEND + "/metrics/runtime", {
        method: "GET",
        credentials: "include"
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("HTTP " + response.status);
          }
          return response.json();
        })
        .then(function (data) {
          data = data || {};

          data.cpu = Number(data.cpu || 0);
          data.rss = Number(data.rss || 0);
          data.responseTimeMs = Number(data.responseTimeMs || data.lastRequestLatency || 0);
          data.gcTimeMs = Number(data.gcTimeMs || 0);
          data.heapGrowthRate = Number(data.heapGrowthRate || 0);
          data.healthScore = Number(data.healthScore || 0);
          data.uptimeSec = Number(data.uptimeSec || 0);
          data.elLagMs = Number(data.elLagMs || 0);

          const memMb = data.rss / 1024 / 1024;

          this._pushHistoryPoint(this._cpuHistory, data.cpu);
          this._pushHistoryPoint(this._memHistory, memMb);
          this._pushHistoryPoint(this._healthHistory, data.healthScore);
          this._pushHistoryPoint(this._respHistory, data.responseTimeMs);
          this._pushHistoryPoint(this._lagHistory, data.elLagMs);
          this._pushHistoryPoint(this._gcHistory, data.gcTimeMs);
          this._pushHistoryPoint(this._heapHistory, data.heapGrowthRate);
          this._pushHistoryPoint(this._uptimeHistory, data.uptimeSec);

          const prevCpu = this._getPreviousValue(this._cpuHistory, data.cpu);
          const prevMem = this._getPreviousValue(this._memHistory, memMb);

          const cpuDelta = data.cpu - prevCpu;
          const memDelta = memMb - prevMem;

          const memPeak = this._getPeakValue(this._memHistory);
          const cpuPeak = this._getPeakValue(this._cpuHistory);

          data.cpuText = data.cpu.toFixed(1) + " %";
          data.memText = memMb.toFixed(1) + " MB";
          data.respText = data.responseTimeMs.toFixed(0) + " ms";
          data.gcText = data.gcTimeMs.toFixed(2) + " ms";
          data.heapText = data.heapGrowthRate.toFixed(2) + " MB/min";
          data.healthText = data.healthScore.toFixed(0) + " %";
          data.uptimeText = this._formatUptime(data.uptimeSec);

          data.cpuPrevText = prevCpu.toFixed(1) + " %";
          data.memPrevText = prevMem.toFixed(1) + " MB";

          data.cpuDeltaText = (cpuDelta >= 0 ? "+" : "") + cpuDelta.toFixed(1) + " %";
          data.memDeltaText = (memDelta >= 0 ? "+" : "") + memDelta.toFixed(1) + " MB";

          data.cpuPeakText = cpuPeak.toFixed(1) + " %";
          data.memPeakText = memPeak.toFixed(1) + " MB";

          data.cpuState =
            data.cpu > 85 ? "Error" :
            data.cpu > 60 ? "Warning" :
            "Success";

          data.lagState =
            data.elLagMs > 250 ? "Error" :
            data.elLagMs > 80 ? "Warning" :
            "Success";

          data.respState =
            data.responseTimeMs > 500 ? "Error" :
            data.responseTimeMs > 200 ? "Warning" :
            "Success";

          data.gcState =
            data.gcTimeMs > 100 ? "Error" :
            data.gcTimeMs > 40 ? "Warning" :
            "Success";

          data.heapState =
            data.heapGrowthRate > 5 ? "Error" :
            data.heapGrowthRate > 2 ? "Warning" :
            "Success";

          data.healthState =
            data.healthScore < 40 ? "Error" :
            data.healthScore < 70 ? "Warning" :
            "Success";

          const detectedCause = this._detectCause(data);
          data.detectedCause = detectedCause;
          data.detectedCauseText = this._prettifyCause(detectedCause);

          this._trackIncident(data);

          const oModel = this.getView().getModel("metrics");
          const currentData = oModel.getData() || {};

          oModel.setData(Object.assign({}, currentData, data, {
            events: this._recentEvents,
            operations: {
              incidentsToday: this._incidentsToday,
              alertsTriggered: this._alertsTriggered,
              lastAnomalyText: this._getLastAnomalyText(),
              incidentStreak: this._currentIncidentStreak
            }
          }));

          this._renderCpuGauge();
          this._renderMemoryTrend();
          this._renderHealthScoreChart();
          this._renderResponseTimeChart();
          this._renderLagChart();
          this._renderGcChart();
          this._renderHeapChart();
          this._renderUptimeChart();
          this._renderCauseDistributionChart();
        }.bind(this))
        .catch(function (err) {
          console.error("Runtime API error", err);
        });
    },

    _loadPersistedEvents: function () {
      try {
        const raw = window.localStorage.getItem(this._storageKey);
        if (!raw) {
          return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.warn("Failed to load persisted incidents", e);
        return [];
      }
    },

    _persistEvents: function () {
      try {
        window.localStorage.setItem(this._storageKey, JSON.stringify(this._recentEvents));
      } catch (e) {
        console.warn("Failed to persist incidents", e);
      }
    },

    _countTodayIncidents: function (events) {
      const today = this._getTodayKey();
      return (events || []).filter(function (event) {
        return event.dayKey === today;
      }).length;
    },

    _detectCause: function (data) {
      if (data.cpu > 85) {
        return "CPU_SATURATION";
      }
      if (data.heapGrowthRate > 2 || (data.rss / 1024 / 1024) > 250) {
        return "MEMORY_PRESSURE";
      }
      if (data.responseTimeMs > 800) {
        return "QUERY_LATENCY";
      }
      if (data.elLagMs > 200) {
        return "REQUEST_BACKLOG";
      }
      if (data.gcTimeMs > 50) {
        return "MEMORY_PRESSURE";
      }
      return "RUNTIME_DEGRADATION";
    },

    _prettifyCause: function (cause) {
      const map = {
        CPU_SATURATION: "CPU Saturation",
        MEMORY_PRESSURE: "Memory Pressure",
        QUERY_LATENCY: "Query Latency",
        REQUEST_BACKLOG: "Request Backlog",
        RUNTIME_DEGRADATION: "Runtime Degradation"
      };
      return map[cause] || cause;
    },

    _trackIncident: function (data) {
      const todayKey = this._getTodayKey();
      if (todayKey !== this._incidentDayKey) {
        this._incidentDayKey = todayKey;
        this._incidentsToday = this._countTodayIncidents(this._recentEvents);
      }

      const isIncident =
        data.healthScore < 70 ||
        data.cpuState === "Error" ||
        data.respState === "Error" ||
        data.lagState === "Error";

      if (!isIncident) {
        this._currentIncidentStreak = 0;
        return;
      }

      const signature = [
        data.detectedCause,
        data.healthScore.toFixed(0),
        data.cpu.toFixed(0),
        data.responseTimeMs.toFixed(0),
        data.elLagMs.toFixed(0)
      ].join("|");

      if (signature === this._lastIncidentSignature) {
        this._currentIncidentStreak += 1;
        return;
      }

      this._lastIncidentSignature = signature;
      this._currentIncidentStreak += 1;
      this._alertsTriggered += 1;
      this._incidentsToday += 1;

      const severity =
        data.healthScore < 40 ? "Critical" :
        data.healthScore < 70 ? "Warning" :
        "Info";

      this._recentEvents.unshift({
        timestamp: this._formatTimestamp(new Date()),
        isoTimestamp: new Date().toISOString(),
        dayKey: todayKey,
        alertType: "runtime.degradation",
        severity: severity,
        detectedCause: this._prettifyCause(data.detectedCause),
        healthScore: data.healthScore.toFixed(0) + " %",
        summary: "CPU " + data.cpu.toFixed(1) + "% · Latency " + data.responseTimeMs.toFixed(0) + " ms"
      });

      if (this._recentEvents.length > this._maxRecentEvents) {
        this._recentEvents.pop();
      }

      this._persistEvents();
    },

    _getTodayKey: function () {
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    },

    _getLastAnomalyText: function () {
      if (!this._recentEvents.length) {
        return "No anomaly yet";
      }
      return this._recentEvents[0].timestamp;
    },

    _formatTimestamp: function (date) {
      const pad = function (n) {
        return String(n).padStart(2, "0");
      };
      return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
    },

    _formatUptime: function (seconds) {
      seconds = Math.floor(Number(seconds || 0));

      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;

      if (days > 0) {
        return days + "d " + hours + "h";
      }
      if (hours > 0) {
        return hours + "h " + minutes + "m";
      }
      if (minutes > 0) {
        return minutes + "m " + secs + "s";
      }
      return secs + " sec";
    },

    _pushHistoryPoint: function (historyArray, value) {
      historyArray.push({
        time: new Date(),
        value: Number(value || 0)
      });

      if (historyArray.length > this._maxHistoryPoints) {
        historyArray.shift();
      }
    },

    _getPreviousValue: function (historyArray, fallbackValue) {
      if (!historyArray || historyArray.length < 2) {
        return Number(fallbackValue || 0);
      }
      return Number(historyArray[historyArray.length - 2].value || 0);
    },

    _getPeakValue: function (historyArray) {
      if (!historyArray || !historyArray.length) {
        return 0;
      }
      return Math.max.apply(null, historyArray.map(function (p) {
        return Number(p.value || 0);
      }));
    },

    _buildLineChartSvg: function (history, options) {
      if (!history || !history.length) {
        return options.emptyText || "";
      }

      const width = options.width || 280;
      const height = options.height || 150;
      const leftPad = options.leftPad || 14;
      const rightPad = options.rightPad || 14;
      const topPad = options.topPad || 20;
      const bottomPad = options.bottomPad || 26;
      const innerWidth = width - leftPad - rightPad;
      const innerHeight = height - topPad - bottomPad;

      const values = history.map(function (p) {
        return Number(p.value || 0);
      });

      const minVal = Math.min.apply(null, values);
      const maxVal = Math.max.apply(null, values);
      const yMin = Math.max(0, options.yMin !== undefined ? options.yMin : minVal * 0.9);
      const yMax = maxVal === minVal ? maxVal + (options.flatPadding || 10) : maxVal * (options.yMaxMultiplier || 1.1);
      const range = yMax - yMin || 1;

      const points = history.map(function (point, index) {
        const x = leftPad + (history.length === 1 ? innerWidth / 2 : (index * innerWidth / (history.length - 1)));
        const y = topPad + ((yMax - point.value) / range) * innerHeight;
        return { x: x, y: y, value: point.value };
      });

      const linePath = points.map(function (p, i) {
        return (i === 0 ? "M" : "L") + " " + p.x + " " + p.y;
      }).join(" ");

      const lastPoint = points[points.length - 1];
      const currentValue = values[values.length - 1];

      return `
        <svg viewBox="0 0 ${width} ${height}" class="${options.svgClass}" aria-label="${options.ariaLabel}">
          <line x1="${leftPad}" y1="${topPad + innerHeight}" x2="${width - rightPad}" y2="${topPad + innerHeight}" class="${options.baseClass}"></line>
          <path d="${linePath}" class="${options.lineClass}"></path>
          <circle cx="${lastPoint.x}" cy="${lastPoint.y}" r="4.5" class="${options.pointClass}"></circle>
          <text x="${width - rightPad}" y="14" text-anchor="end" class="${options.valueClass}">${currentValue.toFixed(options.decimals || 0)} ${options.unit || ""}</text>
        </svg>
        <div class="${options.footerClass}">
          <span>2 min</span>
          <span>now</span>
        </div>
      `;
    },

    _renderCpuGauge: function () {
      const oMetrics = this.getView().getModel("metrics");
      if (!oMetrics) {
        return;
      }

      let cpuValue = Number(oMetrics.getProperty("/cpu") || 0);
      cpuValue = Math.max(0, Math.min(100, cpuValue));

      const radius = 90;
      const centerX = 110;
      const centerY = 110;

      const polarToCartesian = function (cx, cy, r, angle) {
        const rad = (angle - 90) * Math.PI / 180;
        return {
          x: cx + (r * Math.cos(rad)),
          y: cy + (r * Math.sin(rad))
        };
      };

      const describeArc = function (cx, cy, r, startAngle, endAngle) {
        const start = polarToCartesian(cx, cy, r, endAngle);
        const end = polarToCartesian(cx, cy, r, startAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

        return [
          "M", start.x, start.y,
          "A", r, r, 0, largeArcFlag, 0, end.x, end.y
        ].join(" ");
      };

      const valueAngle = 180 * (cpuValue / 100);
      const greenArc = describeArc(centerX, centerY, radius, 270, 330);
      const yellowArc = describeArc(centerX, centerY, radius, 330, 390);
      const redArc = describeArc(centerX, centerY, radius, 390, 450);
      const activeArc = describeArc(centerX, centerY, radius, 270, 270 + valueAngle);

      let activeColor = "#22c55e";
      if (cpuValue >= 70) {
        activeColor = "#f59e0b";
      }
      if (cpuValue >= 85) {
        activeColor = "#ef4444";
      }

      const sSvg = `
        <div class="semiGaugeCardInner">
          <svg viewBox="0 0 220 140" class="semiGaugeSvg" aria-label="CPU Usage Gauge">
            <path d="${greenArc}" stroke="#22c55e" stroke-width="16" fill="none" stroke-linecap="round" opacity="0.20"></path>
            <path d="${yellowArc}" stroke="#facc15" stroke-width="16" fill="none" stroke-linecap="round" opacity="0.20"></path>
            <path d="${redArc}" stroke="#ef4444" stroke-width="16" fill="none" stroke-linecap="round" opacity="0.20"></path>
            <path d="${activeArc}" stroke="${activeColor}" stroke-width="16" fill="none" stroke-linecap="round"></path>
            <text x="110" y="92" text-anchor="middle" class="semiGaugeValue">${cpuValue.toFixed(1)}%</text>
            <text x="110" y="114" text-anchor="middle" class="semiGaugeLabel">CPU Load</text>
          </svg>
        </div>
      `;

      const el = document.getElementById("cpuGaugeContainer");
      if (el) {
        el.innerHTML = sSvg;
      }
    },

    _renderMemoryTrend: function () {
      const el = document.getElementById("memTrendContainer");
      if (!el) {
        return;
      }

      const history = this._memHistory || [];
      if (!history.length) {
        el.innerHTML = "<div class='memoryTrendEmpty'>Waiting for memory samples...</div>";
        return;
      }

      const width = 460;
      const height = 210;
      const leftPad = 18;
      const rightPad = 18;
      const topPad = 26;
      const bottomPad = 34;
      const innerWidth = width - leftPad - rightPad;
      const innerHeight = height - topPad - bottomPad;

      const values = history.map(function (p) { return Number(p.value || 0); });
      const minVal = Math.min.apply(null, values);
      const maxVal = Math.max.apply(null, values);
      const yMin = Math.max(0, minVal * 0.92);
      const yMax = maxVal === minVal ? maxVal + 10 : maxVal * 1.08;
      const range = yMax - yMin || 1;

      const points = history.map(function (point, index) {
        const x = leftPad + (history.length === 1 ? innerWidth / 2 : (index * innerWidth / (history.length - 1)));
        const y = topPad + ((yMax - point.value) / range) * innerHeight;
        return { x: x, y: y, value: point.value, index: index };
      });

      const linePath = points.map(function (p, i) {
        return (i === 0 ? "M" : "L") + " " + p.x + " " + p.y;
      }).join(" ");

      const areaPath =
        linePath +
        " L " + points[points.length - 1].x + " " + (topPad + innerHeight) +
        " L " + points[0].x + " " + (topPad + innerHeight) +
        " Z";

      const lastPoint = points[points.length - 1];
      const currentValue = values[values.length - 1];

      let peakIndex = 0;
      values.forEach(function (v, i) {
        if (v >= values[peakIndex]) {
          peakIndex = i;
        }
      });

      const peakPoint = points[peakIndex];
      const peakValue = values[peakIndex];

      const gridLines = [0.25, 0.5, 0.75].map(function (ratio) {
        const y = topPad + innerHeight * ratio;
        return `<line x1="${leftPad}" y1="${y}" x2="${width - rightPad}" y2="${y}" class="memoryGridLine"></line>`;
      }).join("");

      const svg = `
        <div class="memoryMonitorCard">
          <div class="memoryMonitorHeader">
            <div class="memoryLegendDot"></div>
            <div class="memoryHeaderLabel">RSS Trend · last 2 min</div>
          </div>

          <svg viewBox="0 0 ${width} ${height}" class="memoryTrendSvg" aria-label="Memory Trend">
            ${gridLines}
            <path d="${areaPath}" class="memoryAreaPath"></path>
            <path d="${linePath}" class="memoryLinePath"></path>
            <circle cx="${peakPoint.x}" cy="${peakPoint.y}" r="5.5" class="memoryPeakPoint"></circle>
            <circle cx="${lastPoint.x}" cy="${lastPoint.y}" r="5" class="memoryLastPoint"></circle>
            <text x="${peakPoint.x}" y="${peakPoint.y - 14}" text-anchor="middle" class="memoryPeakLabel">Peak ${peakValue.toFixed(1)} MB</text>
            <text x="${lastPoint.x - 6}" y="${lastPoint.y - 14}" text-anchor="end" class="memoryCurrentLabel">${currentValue.toFixed(1)} MB</text>
          </svg>

          <div class="memoryFooterLabels">
            <span>2 min ago</span>
            <span>now</span>
          </div>
        </div>
      `;

      el.innerHTML = svg;
    },

    _renderHealthScoreChart: function () {
      const el = document.getElementById("healthScoreChartContainer");
      if (!el) {
        return;
      }

      const score = Math.max(0, Math.min(100, Number(this.getView().getModel("metrics").getProperty("/healthScore") || 0)));

      let color = "#ef4444";
      let label = "Unhealthy";
      if (score >= 40 && score < 80) {
        color = "#f59e0b";
        label = "Neutral";
      }
      if (score >= 80) {
        color = "#0ea5e9";
        label = "Healthy";
      }

      const radius = 52;
      const cx = 70;
      const cy = 70;
      const circumference = 2 * Math.PI * radius;
      const progress = circumference * (1 - score / 100);

      const svg = `
        <div class="scoreRingCard">
          <svg viewBox="0 0 140 140" class="scoreRingSvg" aria-label="Health Score">
            <circle cx="${cx}" cy="${cy}" r="${radius}" class="scoreRingTrack"></circle>
            <circle
              cx="${cx}"
              cy="${cy}"
              r="${radius}"
              class="scoreRingProgress"
              style="stroke:${color}; stroke-dasharray:${circumference}; stroke-dashoffset:${progress};">
            </circle>
            <text x="70" y="66" text-anchor="middle" class="scoreRingValue">${score.toFixed(0)}</text>
            <text x="70" y="86" text-anchor="middle" class="scoreRingUnit">/ 100</text>
          </svg>
          <div class="scoreRingCategory" style="color:${color};">${label}</div>
        </div>
      `;

      el.innerHTML = svg;
    },

    _renderResponseTimeChart: function () {
      const el = document.getElementById("respTrendContainer");
      if (!el) {
        return;
      }

      const history = this._respHistory || [];
      if (!history.length) {
        el.innerHTML = "<div class='responseTrendEmpty'>Waiting for response samples...</div>";
        return;
      }

      el.innerHTML = `
        <div class="responseTrendCard">
          ${this._buildLineChartSvg(history, {
            width: 280,
            height: 150,
            svgClass: "responseTrendSvg",
            ariaLabel: "Response Time Trend",
            baseClass: "responseTrendBase",
            lineClass: "responseTrendLine",
            pointClass: "responseTrendPoint",
            valueClass: "responseTrendValue",
            footerClass: "responseFooterLabels",
            decimals: 0,
            unit: "ms",
            flatPadding: 30,
            yMaxMultiplier: 1.1
          })}
        </div>
      `;
    },

    _renderLagChart: function () {
      const el = document.getElementById("lagTrendContainer");
      if (!el) {
        return;
      }

      const history = this._lagHistory || [];
      if (!history.length) {
        el.innerHTML = "<div class='lagTrendEmpty'>Waiting for lag samples...</div>";
        return;
      }

      el.innerHTML = `
        <div class="lagTrendCard">
          ${this._buildLineChartSvg(history, {
            width: 280,
            height: 150,
            svgClass: "lagTrendSvg",
            ariaLabel: "Event Loop Lag Trend",
            baseClass: "lagTrendBase",
            lineClass: "lagTrendLine",
            pointClass: "lagTrendPoint",
            valueClass: "lagTrendValue",
            footerClass: "lagFooterLabels",
            decimals: 0,
            unit: "ms",
            flatPadding: 20,
            yMaxMultiplier: 1.15
          })}
        </div>
      `;
    },

    _renderGcChart: function () {
      const el = document.getElementById("gcTrendContainer");
      if (!el) {
        return;
      }

      const history = this._gcHistory || [];
      if (!history.length) {
        el.innerHTML = "<div class='gcTrendEmpty'>Waiting for GC samples...</div>";
        return;
      }

      const width = 280;
      const height = 150;
      const leftPad = 14;
      const rightPad = 14;
      const topPad = 20;
      const bottomPad = 26;
      const innerWidth = width - leftPad - rightPad;
      const innerHeight = height - topPad - bottomPad;

      const values = history.map(function (p) { return Number(p.value || 0); });
      const maxVal = Math.max.apply(null, values);
      const barWidth = innerWidth / history.length - 2;

      const bars = history.map(function (point, index) {
        const x = leftPad + index * (innerWidth / history.length);
        const h = maxVal > 0 ? (point.value / maxVal) * innerHeight : 2;
        const y = topPad + innerHeight - h;
        const cls = index === history.length - 1 ? "gcBar gcBarActive" : "gcBar";
        return `<rect x="${x}" y="${y}" width="${Math.max(barWidth, 2)}" height="${Math.max(h, 2)}" class="${cls}"></rect>`;
      }).join("");

      el.innerHTML = `
        <div class="gcTrendCard">
          <svg viewBox="0 0 ${width} ${height}" class="gcTrendSvg" aria-label="GC Duration Trend">
            <line x1="${leftPad}" y1="${topPad + innerHeight}" x2="${width - rightPad}" y2="${topPad + innerHeight}" class="gcTrendBase"></line>
            ${bars}
            <text x="${width - rightPad}" y="14" text-anchor="end" class="gcTrendValue">${values[values.length - 1].toFixed(2)} ms</text>
          </svg>
          <div class="gcFooterLabels">
            <span>2 min</span>
            <span>now</span>
          </div>
        </div>
      `;
    },

    _renderHeapChart: function () {
      const el = document.getElementById("heapTrendContainer");
      if (!el) {
        return;
      }

      const history = this._heapHistory || [];
      if (!history.length) {
        el.innerHTML = "<div class='heapTrendEmpty'>Waiting for heap growth samples...</div>";
        return;
      }

      el.innerHTML = `
        <div class="heapTrendCard">
          ${this._buildLineChartSvg(history, {
            width: 280,
            height: 150,
            svgClass: "heapTrendSvg",
            ariaLabel: "Heap Growth Trend",
            baseClass: "heapTrendBase",
            lineClass: "heapTrendLine",
            pointClass: "heapTrendPoint",
            valueClass: "heapTrendValue",
            footerClass: "heapFooterLabels",
            decimals: 2,
            unit: "MB/min",
            flatPadding: 2,
            yMaxMultiplier: 1.15
          })}
        </div>
      `;
    },

    _renderUptimeChart: function () {
      const el = document.getElementById("uptimeChartContainer");
      if (!el) {
        return;
      }

      const oMetrics = this.getView().getModel("metrics");
      const uptimeSec = Number(oMetrics.getProperty("/uptimeSec") || 0);
      const maxDisplaySec = 7200;
      const progress = Math.max(0, Math.min(100, (uptimeSec / maxDisplaySec) * 100));

      el.innerHTML = `
        <div class="uptimeTrackCard">
          <div class="uptimeTrackHeader">
            <span class="uptimeTrackValue">${this._formatUptime(uptimeSec)}</span>
            <span class="uptimeTrackCaption">stable runtime</span>
          </div>
          <div class="uptimeTrackBar">
            <div class="uptimeTrackFill" style="width:${progress}%"></div>
          </div>
          <div class="uptimeFooterLabels">
            <span>start</span>
            <span>now</span>
          </div>
        </div>
      `;
    },

    _renderCauseDistributionChart: function () {
      const el = document.getElementById("causeDistContainer");
      if (!el) {
        return;
      }

      if (!this._recentEvents.length) {
        el.innerHTML = "<div class='causeDistEmpty'>No recent incidents yet.</div>";
        return;
      }

      const counts = {};
      this._recentEvents.forEach(function (event) {
        counts[event.detectedCause] = (counts[event.detectedCause] || 0) + 1;
      });

      const items = Object.keys(counts).map(function (key) {
        return {
          label: key,
          value: counts[key]
        };
      }).sort(function (a, b) {
        return b.value - a.value;
      });

      const maxVal = Math.max.apply(null, items.map(function (i) { return i.value; }));
      const colors = ["#2563eb", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981", "#06b6d4"];

      const bars = items.map(function (item, index) {
        const width = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
        return `
          <div class="causeDistRow">
            <div class="causeDistLabel">${item.label}</div>
            <div class="causeDistBarWrap">
              <div class="causeDistBar" style="width:${width}%; background:${colors[index % colors.length]};"></div>
            </div>
            <div class="causeDistValue">${item.value}</div>
          </div>
        `;
      }).join("");

      el.innerHTML = `<div class="causeDistCard">${bars}</div>`;
    },

    onExportMetricsJson: function () {
      const modelData = this.getView().getModel("metrics").getData() || {};
      const snapshot = {
        exportedAt: new Date().toISOString(),
        runtime: {
          cpu: modelData.cpu,
          rss: modelData.rss,
          responseTimeMs: modelData.responseTimeMs,
          gcTimeMs: modelData.gcTimeMs,
          heapGrowthRate: modelData.heapGrowthRate,
          healthScore: modelData.healthScore,
          uptimeSec: modelData.uptimeSec,
          elLagMs: modelData.elLagMs,
          detectedCause: modelData.detectedCause
        },
        operations: modelData.operations || {},
        recentEvents: modelData.events || []
      };

      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "runtime-metrics-snapshot.json";
      a.click();
      URL.revokeObjectURL(url);

      MessageToast.show("Metrics JSON exported");
    },

    onDownloadIncidentSnapshot: function () {
      this._downloadEventsCsv("incident-snapshot.csv");
    },

    onExportEventsCsv: function () {
      this._downloadEventsCsv("runtime-events.csv");
    },

    onExportEventsExcel: function () {
      const events = this._recentEvents || [];
      let tableHtml = "<table><thead><tr>" +
        "<th>Timestamp</th>" +
        "<th>ISO Timestamp</th>" +
        "<th>Alert Type</th>" +
        "<th>Severity</th>" +
        "<th>Detected Cause</th>" +
        "<th>Health Score</th>" +
        "<th>Summary</th>" +
        "</tr></thead><tbody>";

      events.forEach(function (event) {
        tableHtml += "<tr>" +
          "<td>" + (event.timestamp || "") + "</td>" +
          "<td>" + (event.isoTimestamp || "") + "</td>" +
          "<td>" + (event.alertType || "") + "</td>" +
          "<td>" + (event.severity || "") + "</td>" +
          "<td>" + (event.detectedCause || "") + "</td>" +
          "<td>" + (event.healthScore || "") + "</td>" +
          "<td>" + (event.summary || "") + "</td>" +
          "</tr>";
      });

      tableHtml += "</tbody></table>";

      const blob = new Blob([tableHtml], { type: "application/vnd.ms-excel" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "runtime-events.xls";
      a.click();
      URL.revokeObjectURL(url);

      MessageToast.show("Events exported to Excel");
    },

    _downloadEventsCsv: function (fileName) {
      const events = this._recentEvents || [];
      let csv = "timestamp,isoTimestamp,alertType,severity,detectedCause,healthScore,summary\n";

      events.forEach(function (event) {
        csv += [
          event.timestamp || "",
          event.isoTimestamp || "",
          event.alertType || "",
          event.severity || "",
          event.detectedCause || "",
          event.healthScore || "",
          '"' + String(event.summary || "").replace(/"/g, '""') + '"'
        ].join(",") + "\n";
      });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      MessageToast.show("Events exported to CSV");
    },

    onCopyDiagnosticSummary: function () {
      const modelData = this.getView().getModel("metrics").getData() || {};

      const summary =
        "Runtime Diagnostic Summary\n" +
        "Health Score: " + (modelData.healthText || "") + "\n" +
        "CPU: " + (modelData.cpuText || "") + "\n" +
        "Memory: " + (modelData.memText || "") + "\n" +
        "Response Time: " + (modelData.respText || "") + "\n" +
        "Event Loop Lag: " + (modelData.elLagMs || 0) + " ms\n" +
        "GC Duration: " + (modelData.gcText || "") + "\n" +
        "Heap Growth Rate: " + (modelData.heapText || "") + "\n" +
        "Detected Cause: " + (modelData.detectedCauseText || "N/A") + "\n" +
        "Last Anomaly: " + ((modelData.operations && modelData.operations.lastAnomalyText) || "N/A");

      navigator.clipboard.writeText(summary).then(function () {
        MessageToast.show("Diagnostic summary copied");
      }).catch(function () {
        MessageToast.show("Clipboard copy failed");
      });
    },

    onResetIncidents: function () {
  const that = this;

  sap.m.MessageBox.warning(
    "Are you sure you want to reset all stored incidents?",
    {
      actions: ["Cancel", "Continue"],
      emphasizedAction: "Continue",
      onClose: function (sAction) {
        if (sAction !== "Continue") {
          return;
        }

        sap.m.MessageBox.error(
          "This will permanently delete the incident history. Are you absolutely sure you want to reset?",
          {
            actions: ["No", "Yes, Reset"],
            emphasizedAction: "Yes, Reset",
            onClose: function (sSecondAction) {
              if (sSecondAction !== "Yes, Reset") {
                return;
              }

              that._resetIncidentState();
              MessageToast.show("Incident history reset");
            }
          }
        );
      }
    }
  );
},
onResetAll: function () {
  const that = this;

  sap.m.MessageBox.warning(
    "Are you sure you want to reset all monitoring counters and incident history?",
    {
      actions: ["Cancel", "Continue"],
      emphasizedAction: "Continue",
      onClose: function (sAction) {
        if (sAction !== "Continue") {
          return;
        }

        sap.m.MessageBox.error(
          "This will permanently clear the stored incidents, reset counters to zero, and remove the current anomaly history. Are you absolutely sure?",
          {
            actions: ["No", "Yes, Reset Everything"],
            emphasizedAction: "Yes, Reset Everything",
            onClose: function (sSecondAction) {
              if (sSecondAction !== "Yes, Reset Everything") {
                return;
              }

              that._recentEvents = [];
              that._alertsTriggered = 0;
              that._incidentsToday = 0;
              that._currentIncidentStreak = 0;
              that._lastIncidentSignature = "";
              that._incidentDayKey = that._getTodayKey();

              that._persistEvents();

              const oModel = that.getView().getModel("metrics");
              const currentData = oModel.getData() || {};

              oModel.setData(Object.assign({}, currentData, {
                events: [],
                detectedCause: "",
                detectedCauseText: "N/A",
                operations: {
                  incidentsToday: 0,
                  alertsTriggered: 0,
                  lastAnomalyText: "No anomaly yet",
                  incidentStreak: 0
                }
              }));

              that._renderCauseDistributionChart();
              MessageToast.show("All monitoring counters and incidents were reset");
            }
          }
        );
      }
    }
  );
},
_resetIncidentState: function () {
  this._recentEvents = [];
  this._alertsTriggered = 0;
  this._incidentsToday = 0;
  this._currentIncidentStreak = 0;
  this._lastIncidentSignature = "";
  this._incidentDayKey = this._getTodayKey();
  this._persistEvents();

  const oModel = this.getView().getModel("metrics");
  const currentData = oModel.getData() || {};

  oModel.setData(Object.assign({}, currentData, {
    events: [],
    detectedCause: "",
    detectedCauseText: "N/A",
    operations: {
      incidentsToday: 0,
      alertsTriggered: 0,
      lastAnomalyText: "No anomaly yet",
      incidentStreak: 0
    }
  }));

  this._renderCauseDistributionChart();
},

onResetAll: function () {
  const that = this;

  sap.m.MessageBox.warning(
    "Are you sure you want to reset all monitoring counters and incidents?",
    {
      actions: ["Cancel", "Continue"],
      emphasizedAction: "Continue",
      onClose: function (sAction) {
        if (sAction !== "Continue") {
          return;
        }

        sap.m.MessageBox.error(
          "This will reset counters to zero and permanently clear the stored incident history. Are you absolutely sure?",
          {
            actions: ["No", "Yes, Reset Everything"],
            emphasizedAction: "Yes, Reset Everything",
            onClose: function (sSecondAction) {
              if (sSecondAction !== "Yes, Reset Everything") {
                return;
              }

              that._resetIncidentState();
              MessageToast.show("Monitoring state fully reset");
            }
          }
        );
      }
    }
  );
},
onDownloadPdfSummary: function () {
  var API_BASE = "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";
  var modelData = this.getView().getModel("metrics").getData() || {};

  console.log("[PDF EXPORT] modelData:", modelData);

  var payload = {
    runtime: {
      cpu: Number(modelData.cpu || 0),
      rss: Number(modelData.rss || 0),
      responseTimeMs: Number(modelData.responseTimeMs || 0),
      gcTimeMs: Number(modelData.gcTimeMs || 0),
      heapGrowthRate: Number(modelData.heapGrowthRate || 0),
      healthScore: Number(modelData.healthScore || 0),
      uptimeSec: Number(modelData.uptimeSec || 0),
      elLagMs: Number(modelData.elLagMs || 0),
      detectedCause: modelData.detectedCause || "",
      detectedCauseText: modelData.detectedCauseText || ""
    },
    operations: modelData.operations || {},
    events: modelData.events || []
  };

  console.log("[PDF EXPORT] payload:", payload);

  var form = document.createElement("form");
  form.method = "POST";
  form.action = API_BASE + "/metrics/export/pdf";
  form.target = "_blank";
  form.enctype = "application/x-www-form-urlencoded";
  form.style.display = "none";

  var textarea = document.createElement("textarea");
  textarea.name = "payload";
  textarea.value = JSON.stringify(payload);

  form.appendChild(textarea);
  document.body.appendChild(form);

  form.submit();

  setTimeout(function () {
    document.body.removeChild(form);
  }, 1000);

  MessageToast.show("PDF generation started");
},

    _buildPdfRecommendation: function (modelData) {
      const cause = modelData.detectedCause || "";
      const healthScore = Number(modelData.healthScore || 0);
      const cpu = Number(modelData.cpu || 0);
      const resp = Number(modelData.responseTimeMs || 0);
      const lag = Number(modelData.elLagMs || 0);
      const heap = Number(modelData.heapGrowthRate || 0);

      if (cause === "CPU_SATURATION" || cpu > 85) {
        return "The backend is currently showing signs of CPU saturation. The recommended next steps are to inspect CPU-intensive endpoints, review concurrent load patterns, and consider scaling or workload redistribution if the condition persists.";
      }

      if (cause === "MEMORY_PRESSURE" || heap > 2) {
        return "The runtime signals suggest memory pressure or sustained heap growth. The recommended action is to inspect recent allocations, review possible leaks, and monitor garbage collection efficiency over a longer window.";
      }

      if (cause === "QUERY_LATENCY" || resp > 800) {
        return "The dominant signal is high response latency. This usually points to slow downstream dependencies, expensive queries, or request congestion. The priority should be reviewing dependency timing and high-latency routes.";
      }

      if (cause === "REQUEST_BACKLOG" || lag > 200) {
        return "The event loop lag indicates possible request backlog or blocking operations on the main thread. The recommended next step is to inspect synchronous processing and long-running handlers.";
      }

      if (healthScore < 40) {
        return "The global health score is critical. A broader runtime degradation is in progress, and immediate diagnostic attention is recommended across CPU, latency, event loop, and memory indicators.";
      }

      if (healthScore < 70) {
        return "The system is degraded but still operating. It is recommended to continue close observation, correlate recent alerts with traffic changes, and validate whether the detected cause is transient or persistent.";
      }

      return "The backend is currently in a healthy state. No urgent corrective action is required, but the current baseline can be used as a useful reference for future anomaly comparison.";
    },

    onResetIncidents: function () {
  const that = this;

  sap.m.MessageBox.warning(
    "Are you sure you want to reset all stored incidents?",
    {
      actions: ["Cancel", "Continue"],
      emphasizedAction: "Continue",
      onClose: function (sAction) {
        if (sAction !== "Continue") {
          return;
        }

        sap.m.MessageBox.error(
          "This will permanently delete the incident history. Are you absolutely sure you want to reset?",
          {
            actions: ["No", "Yes, Reset"],
            emphasizedAction: "Yes, Reset",
            onClose: function (sSecondAction) {
              if (sSecondAction !== "Yes, Reset") {
                return;
              }

              that._resetIncidentState();
              MessageToast.show("Incident history reset");
            }
          }
        );
      }
    }
  );
},
onResetAll: function () {
  const that = this;

  sap.m.MessageBox.warning(
    "Are you sure you want to reset all monitoring counters and incident history?",
    {
      actions: ["Cancel", "Continue"],
      emphasizedAction: "Continue",
      onClose: function (sAction) {
        if (sAction !== "Continue") {
          return;
        }

        sap.m.MessageBox.error(
          "This will permanently clear the stored incidents, reset counters to zero, and remove the current anomaly history. Are you absolutely sure?",
          {
            actions: ["No", "Yes, Reset Everything"],
            emphasizedAction: "Yes, Reset Everything",
            onClose: function (sSecondAction) {
              if (sSecondAction !== "Yes, Reset Everything") {
                return;
              }

              that._recentEvents = [];
              that._alertsTriggered = 0;
              that._incidentsToday = 0;
              that._currentIncidentStreak = 0;
              that._lastIncidentSignature = "";
              that._incidentDayKey = that._getTodayKey();

              that._persistEvents();

              const oModel = that.getView().getModel("metrics");
              const currentData = oModel.getData() || {};

              oModel.setData(Object.assign({}, currentData, {
                events: [],
                detectedCause: "",
                detectedCauseText: "N/A",
                operations: {
                  incidentsToday: 0,
                  alertsTriggered: 0,
                  lastAnomalyText: "No anomaly yet",
                  incidentStreak: 0
                }
              }));

              that._renderCauseDistributionChart();
              MessageToast.show("All monitoring counters and incidents were reset");
            }
          }
        );
      }
    }
  );
},
_resetIncidentState: function () {
  this._recentEvents = [];
  this._alertsTriggered = 0;
  this._incidentsToday = 0;
  this._currentIncidentStreak = 0;
  this._lastIncidentSignature = "";
  this._incidentDayKey = this._getTodayKey();
  this._persistEvents();

  const oModel = this.getView().getModel("metrics");
  const currentData = oModel.getData() || {};

  oModel.setData(Object.assign({}, currentData, {
    events: [],
    detectedCause: "",
    detectedCauseText: "N/A",
    operations: {
      incidentsToday: 0,
      alertsTriggered: 0,
      lastAnomalyText: "No anomaly yet",
      incidentStreak: 0
    }
  }));

  this._renderCauseDistributionChart();
},
onResetAll: function () {
  const that = this;

  sap.m.MessageBox.warning(
    "Are you sure you want to reset all monitoring counters and incidents?",
    {
      actions: ["Cancel", "Continue"],
      emphasizedAction: "Continue",
      onClose: function (sAction) {
        if (sAction !== "Continue") {
          return;
        }

        sap.m.MessageBox.error(
          "This will reset counters to zero and permanently clear the stored incident history. Are you absolutely sure?",
          {
            actions: ["No", "Yes, Reset Everything"],
            emphasizedAction: "Yes, Reset Everything",
            onClose: function (sSecondAction) {
              if (sSecondAction !== "Yes, Reset Everything") {
                return;
              }

              that._resetIncidentState();
              MessageToast.show("Monitoring state fully reset");
            }
          }
        );
      }
    }
  );
},

    onGoSecurity: function () {
      this.getOwnerComponent().getRouter().navTo("security", {}, false);
    },

    onGoSystemHealth: function () {
      this.getOwnerComponent().getRouter().navTo("systemHealth", {}, false);
    },

    goRisk: function () {
      this.getOwnerComponent().getRouter().navTo("risk", {}, false);
    },

    goKmeans: function () {
      this.getOwnerComponent().getRouter().navTo("kmeans", {}, false);
    },
    

    onExit: function () {
      if (this._interval) {
        clearInterval(this._interval);
      }
    }

  });
});