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

## Iframe message contract

Send the initial data from the parent frame after the iframe has loaded. The page accepts this object shape, `{ columns, rows }`, or the aliases `{ columns, data }` and `[columns, rows]`:

```js
employeeFrame.contentWindow.postMessage(
  {
    type: "employee-tabulator:init",
    columns: [
      { title: "Employee ID", field: "employeeId" },
      { title: "First name", field: "firstName" },
      { title: "Department", field: "department" },
    ],
    rows: [
      { employeeId: "LF-0001", firstName: "Morgan", department: "People" },
    ],
  },
  "https://your-hosted-tabulator.example",
);
```

Columns may also be an array of field-name strings. Column objects use Tabulator's column definition format. Data rows are objects keyed by each column's `field`. Initial records are locked; use the final **Row access** column to unlock a row before editing it. The **Add employee** action creates an unlocked record. Select a row before choosing **Remove selected**.

On **Save changes**, the iframe posts this payload to its parent:

```js
{
  type: 'employee-tabulator:save',
  added: [{ employeeId: '', firstName: '', department: '', locked: false }],
  updated: [{ employeeId: 'LF-0001', firstName: 'Morgan', department: 'People', locked: false }],
  deleted: [{ employeeId: 'LF-0002', firstName: 'Avery', department: 'Finance', locked: true }],
}
```

Each list contains only records changed in that category. Row-lock state is returned as `locked`. Internal table identifiers are omitted. For security, messages are accepted only from the parent frame and from `https://sandbox-forms.laserfiche.com`, `https://sandbox-forms.laserfiche.ca`, or the page's own origin. The response is posted to the origin that sent the initialization message. The ready handshake is sent to both Laserfiche sandbox region origins.
