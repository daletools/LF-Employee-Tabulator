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

## Iframe data contract

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

The grid joins each flight to its employee by `Employee_Number`; employees with no flight get a blank flight row. Employee number, full name, and status are read-only. Unlocking a row enables only flight fields. Flight Number is an autocomplete list based on existing flight data; selecting one fills carrier, origin, destination, date, and type from that flight definition. Selecting the blank option clears those fields and marks the employee row for deletion. Flight type is restricted to `Arrival` or `Departure` for assigned flights. Dates are displayed as `YYYY-MM-DD` and sent back as the LFForm DateTime value object `{ dateStr, timeStr? }`.

On **Save changes**, the page sends `{ type: "employee-tabulator:save", flights: [...] }` directly to the form sandbox. Assigned flights and deletion markers (employee number plus blank flight fields) are appended as new rows in table field `59`, setting fields `60` through `66` in order: employee number, flight number, carrier, origin, destination, DateTime, and flight type. A later process can interpret blank flight fields as a deletion request. The source employee and flight tables are fields `44` and `50`; flight columns are fields `51` through `57`. The form waits for changes to fields `47` and `57` before sending the initial snapshot.

**Temporary proof-of-concept messaging:** the form script probes child frames of its parent with `employee-tabulator:hello` every 250 ms. The hosted page replies with `employee-tabulator:ready` directly to the hello sender, and the form sends the init object directly to that frame. This test mode accepts init messages from any sender; restore strict origin and source validation before production use.
