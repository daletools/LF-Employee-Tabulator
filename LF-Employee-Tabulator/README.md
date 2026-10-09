# LF Employee Tabulator

A hosted employee register for embedding in a Laserfiche Cloud form. Tabulator virtualizes the rows so the page remains responsive with 3,000+ records.

## Run locally

```sh
npm install
npm run dev
```

Use **Preview with 3,000 sample records** to exercise the grid without a form.

## Deploy to GitHub Pages

The repository includes a GitHub Actions deployment workflow. In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. Push the `main` branch or run **Deploy to GitHub Pages** from the Actions tab to publish the site.

The live site URL is <https://daletools.github.io/LF-Employee-Tabulator/>. The workflow installs from this app's lockfile, builds the Vite site with the `/LF-Employee-Tabulator/` base path, and deploys the build artifact. Local development continues to use `/`.

## Laserfiche iframe setup

Embed the hosted page in two separate iframe fields:

- Flight management: `https://daletools.github.io/LF-Employee-Tabulator/`
- Employee requests (field 68): `https://daletools.github.io/LF-Employee-Tabulator/?view=employee-request`

The form script reads employees from table field `44` and farm choices from field `70`. It sends request data after the employee table (field `47`), Employee Flights lookup (field `57`), and farm table (field `70`) report changes. Employee Flights fields `80`, `82`, and `83` supply request status, farm, and requested arrival date. Flight rows are matched by employee number; the Arrival row supplies flight number, flight arrival date, and arrival airport (the flight destination). The request page shows employee number, full name, current status, request status, farm, preferred arrival date, flight number, flight arrival date, and arrival airport. Only Farm and Preferred arrival by are editable; all other columns are read-only. Preferred arrival dates are constrained to tomorrow or later.

The form script probes child frames with `employee-tabulator:hello`; each hosted page replies with `employee-tabulator:ready` and its view. The script keeps the flight and request frames separate and sends each its matching `employee-tabulator:init` payload. The flight page uses the contract below. The request page receives:

```js
{
  type: "employee-tabulator:init",
  view: "employee-request",
  data: {
    employees: [
      { Employee_Number: "4790", FullName: "Diaz Rodriguez, Camila", Status: "Active" },
    ],
    farms: ["North Farm", "South Farm"],
    requests: [
      {
        Employee_Number: "4790",
        Request_Status: "Requested",
        Farm: "North Farm",
        Preferred_Arrival_By: { dateStr: "2026-10-20" },
        Flight_Number: "AC123",
        Flight_Arrival: { dateStr: "2026-10-18", timeStr: "08:30:00 AM" },
        Arrival_Airport: "YYZ",
      },
    ],
  },
}
```

Saving request edits sends `{ type: "employee-request:save", requests: [...] }` to the form script. Each request contains `Employee_Number`, `FullName`, `Request_Status`, `Farm`, `Preferred_Arrival_By`, `Flight_Number`, and `Flight_Arrival`; date values use the LFForm DateTime shape `{ dateStr, timeStr? }`. The form appends saved requests to table field `71`, mapping employee number, full name, request status, farm, preferred arrival, flight number, and flight arrival to fields `72` through `78`. Blank request status, farm, or flight number values are stored as `Cancel`, `TBD`, and `TBD`; blank dates are stored as `{ dateStr: "1900-01-01" }`. Arrival Airport is currently display-only because no output field ID has been provided for it.

## Flight iframe data contract

The form script sends one object after the employee table is populated and the lookup triggered by `Flight_Type` completes:

```js
{
  type: "employee-tabulator:init",
  data: {
    employees: [
      { Employee_Number: "4790", FullName: "Diaz Rodriguez, Camila", Status: "Active" },
    ],
    flights: [
      {
        Employee_Number: "4790",
        Flight_Number: "AC123",
        Flight_Carrier: "Air Canada",
        Flight_Origin: "YVR",
        Flight_Destination: "YYZ",
        Flight_Date: { dateStr: "2026-10-01", timeStr: "08:30:00 AM" },
        Flight_Type: "Departure",
      },
    ],
  },
}
```

The grid joins each flight to its employee by `Employee_Number`; employees with no flight get a blank flight row. Employee number, full name, and status are read-only. Unlocking a row enables only flight fields. Flight Number suggestions come from existing flight data, but free-text values are allowed for defining new flights. Selecting a known number fills its carrier, route, date/time, and type. Editing a nonblank flight's definition updates every row sharing that flight number. Selecting the blank option clears those fields and marks each affected employee row for deletion. Flight type is restricted to `Arrival` or `Departure` for assigned flights. Dates and times are sent back as the LFForm DateTime object `{ dateStr, timeStr? }`.

On **Save changes**, the page first drops any touched row that matches its original flight data, then sends `{ type: "employee-tabulator:save", flights: [...] }` directly to the form sandbox. Assigned flights and deletion markers (employee number plus blank flight fields) are appended as new rows in table field `59`, setting fields `60` through `66` in order: employee number, flight number, carrier, origin, destination, DateTime, and flight type. A later process can interpret blank flight fields as a deletion request. The source employee and flight tables are fields `44` and `50`; flight columns are fields `51` through `57`. The form waits for changes to fields `47` and `57` before sending the initial snapshot.
