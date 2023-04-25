import { Chart as ChartJS } from 'chart.js/auto';
import { sub } from 'date-fns';
import DataTable from '../../components/data-table/data-table.js';
import SlotDataProvider from '../../providers/slot-data-provider.js';
import SlotRefProvider from '../../providers/slot-ref-provider.js';
import ChartZoom from '../../components/chart-zoom/chart-zoom.js';

/**
 * Base Chart, handles most of the setup/dirty work for templating, and chart creation
 * @class
 * @abstract
 */
export default class BaseChart extends HTMLElement {
  /**
   * HTML template element that contains the DOM portion of the chart (excluding chart.js)
   * @type HTMLTemplateElement
   */
  _template;

  /**
   * HTML canvas element that will hold our chart.js chart
   * @type HTMLCanvasElement
   */
  _canvas;

  /**
   * @type ShadowRoot
   */
  _shadowRoot;

  /**
   * @type ChartJS
   * @protected
   */
  _chart;

  _chartBounds = {};

  _slots = [];

  _chartZoomModules = [];

  _defaultZoom = '1yr';

  constructor(templateHTML) {
    super();

    this._template = document.createElement('template');
    this._template.innerHTML = templateHTML;

    this._shadowRoot = this.attachShadow({ mode: 'open' });
    this._shadowRoot.appendChild(this._template.content);

    this._slots = this._shadowRoot.querySelectorAll('slot');

    this._canvas = this._shadowRoot.getElementById('canvas');

    // Listen for any filter events
    this._shadowRoot.addEventListener('filter', (evt) => this.onFilter(evt), true);

    this.slotRefProvider = new SlotRefProvider(this, ChartZoom, this._slots);
    this.slotDataProvider = new SlotDataProvider(DataTable, this._slots);

    this.addEventListener('ref-event', (evt) => {
      if (evt.target !== this) {
        return;
      }
      this._chartZoomModules = Object.values(evt.data).flat();
    }, true);
  }

  onFilter(evt) {
    if (evt.detail.reset) {
      this._chart.resetZoom();
      return;
    }

    const scaleType = this._chart.scales.x.type;

    if (scaleType === 'time') {
      // start/end are months
      if (evt.detail.scale === 'relative') {
        this._filterTimeRelative(evt.detail.start, evt.detail.end);
      } else {
        this._filterTimeAbsolute(evt.detail.start, evt.detail.end);
      }
    } else if (scaleType === 'category') {
      this._filterCategory(evt.detail.start, evt.detail.end);
    } else {
      console.info('Zoom function not supported for xscale type: ', this._chart.scales.x.type);
    }
  }

  _filterCategory(start, end) {
    this._chart.zoomScale('x', { min: start, max: end }, 'default');
  }

  _subDate(timestamp, modifier) {
    return sub(new Date(timestamp), { months: modifier }).valueOf();
  }

  _filterTimeRelative(start, end) {
    const min = this._subDate(this._chartBounds.x.max, start);
    const max = this._subDate(this._chartBounds.x.max, end);

    this._chart.zoomScale('x', { min, max }, 'default');
  }

  _filterTimeAbsolute(start, end) {
    const min = new Date(this._chartBounds.x.max).setMonth(start, 1);
    // Use the current date
    const max = new Date(this._chartBounds.x.max);

    if (max.getMonth() > end) {
      // Last of end's month
      max.setMonth(end + 1, -1);
    }

    this._chart.zoomScale('x', { min, max }, 'default');
  }

  _createChart(type, data, title, options = {}) {
    const {
      datasetOptions, tooltip, scales, legend, point, interaction,
    } = options;

    // Update the line chart cursor when we hover another data point
    // FIXME: This is too slow (chart update), move to a custom canvas solution?
    /*
    let lastX = 0;

    const onHoverUpdateCursor = (evt, elements, chart) => {
      // Small optimization
      if (evt.x === lastX) {
        return;
      }
      lastX = evt.x;

      // Adjust cursor position
      evt.chart.options.plugins.annotation.annotations.cursor.value = Math.floor(
        evt.chart.scales.x.getValueForPixel(evt.x),
      );
      evt.chart.update('none');
    };
    // Vertical line cursor for line charts
    const cursorAnnotation = {
      cursor: {
        display: false,
        type: 'line',
        scaleID: 'x',
        value: ({ chart }) => Object.keys(chart.data.datasets[0].data)[0],
        borderColor: 'rgb(107,107,107)',
        borderWidth: 2,
        drawTime: 'afterDatasetsDraw',
      },
    };
    const isLineChart = type === 'line';
    */
    const isDarkTheme = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const hasYAxis = type === 'line' || type === 'bar';
    const defaultScale = hasYAxis ? {
      y: {
        position: 'right',
      },
    } : {};

    // TODO: Maybe move explicit scale settings to the individual chart classes
    const mergedScale = hasYAxis ? {
      x: {
        ...defaultScale?.x,
        ...scales?.x,
      },
      y: {
        ...defaultScale?.y,
        ...scales?.y,
      },
    } : {
      ...scales,
    };

    const defaultSortFn = (a, b) => b.parsed.y - a.parsed.y;
    const defaultFilterFn = (element, index, array) => {
      // Annoyingly filter comes before the sort function, so do a sort...
      const sortedArray = [...array].sort(defaultSortFn).slice(0, 6);

      for (const sortedElement of sortedArray) {
        if (
          sortedElement.datasetIndex === element.datasetIndex
          && sortedElement.dataIndex === element.dataIndex
        ) {
          return true;
        }
      }

      return false;
    };

    const config = {
      type,
      data,
      options: {
        animation: false, // Disable animations until the chart is loaded (see below)
        datasets: {
          ...datasetOptions,
        },
        // onHover: type === 'line' ? onHoverUpdateCursor : null,
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false,
          ...interaction,
        },
        responsive: true,
        maintainAspectRatio: false,
        elements: {
          point: {
            pointStyle: 'circle',
            hitRadius: 6,
            radius: 0,
            hoverRadius: 6,
            ...point,
          },
        },
        plugins: {
          annotation: {
            animations: false,
            // annotations: isLineChart ? cursorAnnotation : {},
          },
          zoom: {
            zoom: {
              drag: {
                enabled: true,
              },
              mode: 'x',
              onZoomStart: ({ chart }) => {
                // If we're zoomed in, the next zoom will reset our zoom.
                if (chart.isZoomedOrPanned()) {
                  // If we're resetting zoom, disable any buttons
                  this._chartZoomModules.forEach((element) => {
                    element.unselect();
                  });

                  chart.resetZoom();
                  return false;
                }
                return true;
              },
            },
          },
          legend: {
            ...legend,
          },
          tooltip: {
            animation: {
              duration: 16, /* ms */
            },
            mode: 'nearest',
            axis: 'x',
            position: 'constant',
            intersect: false,
            enabled: true,
            usePointStyle: true,
            filter: defaultFilterFn,
            itemSort: defaultSortFn,
            ...tooltip,
          },
          title: {
            display: true,
            text: title,
            color: isDarkTheme ? '#fff' : '#000',
            font: {
              size: 22,
              weight: 400,
            },
          },
        },
        scales: mergedScale,
      },
    };

    this._chart = new ChartJS(this._canvas, config);
    this._chartBounds = this._chart.getInitialScaleBounds();

    // We don't know what scale is going to look like here, but we want to set the background grid based on dark mode
    // So we do after we create the chart, and just silently update it.
    Object.keys(this._chart.scales).forEach((scale) => {
      const color = isDarkTheme
        ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
      this._chart.scales[scale].options.grid = {
        color,
      };
      this._chart.scales[scale].options.border = {
        color,
      };
    });

    this._chart.update('none');

    // Update our slots
    this.slotDataProvider.update(this._chart.data);

    if (this._defaultZoom) {
      this._chartZoomModules.forEach((element) => {
        element.selectByLabel(this._defaultZoom);
      });
    }

    // Re-enable animations now that the chart has settled in its initial position
    this._chart.options.animation = true;
  }

  _updateChart(data) {
    this._chart.data = data;
    this._chart.update();
  }
}
