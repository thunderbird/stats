# Thunderbird Stats

Thunderbird's html and vanilla js stats dashboard.

Thunderbird Stats uses Vite to streamline development and import node modules as needed.

## Install

```
npm install
npm run dev
```

## Charts

### Chart Component
Charts are JavaScript web components that inherit a `base-chart.js`, they are located in `src/assets/js/charts`. 
There's also a `index.js` file that will handle importing the chart for stats.

Below is a small interface for how the charts are generally structured:
```javascript
class Interface extends BaseChart {
  constructor(); // Pass a html template to BaseChart's constructor, and then call fetchData
  fetchData();   // Fetches the data required for the chart. Place the data into a class variable.
  create();      // Setup options, and data for the ChartJS chart. Make sure to call `this._createChart` to create the chart.
};
```

### Transformers
Transformers are a JavaScript class that handles processing the data from source to something ChartJS can handle. 

Below is a small interface for how transformers are generally structured:
```javascript
class Interface {
  constructor(data);  // Pass in the data
  toChartData();      // Transforms the data to ChartJS data format
}
```

### Providers
Providers are a JavaScript class that provides data upon a ready signal. Currently, the only example is the slot data provider.
