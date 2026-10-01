const CUSTOM_HTML_FIELD_ID = 1;

let employeeColumns = [];
let employeeRows = [];

const gridState = {
  filters: {},
  sortField: null,
  sortAscending: true,
  editingRows: new Set(),
};

function initializeGrid(columns, rows) {
  employeeColumns = columns;

  employeeRows = rows.map((row, index) => ({
    ...row,
    __rowId: index,
  }));

  refreshGrid();
}

window.sortGrid = function (field) {
  if (gridState.sortField === field) {
    gridState.sortAscending = !gridState.sortAscending;
  } else {
    gridState.sortField = field;
    gridState.sortAscending = true;
  }

  refreshGrid();
};

window.filterGrid = function (field, value) {
  gridState.filters[field] = value;

  refreshGrid();
};

window.toggleGridEdit = function (rowId) {
  if (gridState.editingRows.has(rowId)) {
    gridState.editingRows.delete(rowId);
  } else {
    gridState.editingRows.add(rowId);
  }

  refreshGrid();
};

window.updateGridCell = function (rowId, field, value) {
  const row = employeeRows.find((r) => r.__rowId === rowId);

  if (row) {
    row[field] = value;
  }
};

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildFullTable(columns, rows) {
  let workingRows = [...rows];

  if (gridState.sortField) {
    workingRows.sort((a, b) => {
      const av = String(a[gridState.sortField] ?? "").toLowerCase();

      const bv = String(b[gridState.sortField] ?? "").toLowerCase();

      if (av < bv) {
        return gridState.sortAscending ? -1 : 1;
      }

      if (av > bv) {
        return gridState.sortAscending ? 1 : -1;
      }

      return 0;
    });
  }

  workingRows = workingRows.filter((row) => {
    return Object.entries(gridState.filters).every(([field, filter]) => {
      if (!filter || filter.trim() === "") {
        return true;
      }

      return String(row[field] ?? "")
        .toLowerCase()
        .includes(filter.toLowerCase());
    });
  });

  return `
<style>

.grid-wrapper{
    max-height:700px;
    overflow:auto;
    font-family:Segoe UI,Arial,sans-serif;
}

.grid-table{
    width:100%;
    border-collapse:collapse;
}

.grid-table th,
.grid-table td{
    border:1px solid #d6d6d6;
    padding:6px;
    white-space:nowrap;
}

.grid-table th{
    background:#f2f2f2;
    position:sticky;
    top:0;
    cursor:pointer;
    z-index:10;
}

.grid-filter-row th{
    background:#fafafa;
}

.grid-filter{
    width:95%;
    box-sizing:border-box;
}

.grid-input{
    width:100%;
    box-sizing:border-box;
}

.grid-edit-btn{
    background:#0078d4;
    color:white;
    border:none;
    border-radius:4px;
    padding:4px 10px;
    cursor:pointer;
}

.grid-edit-btn:hover{
    background:#106ebe;
}

.grid-row-editing{
    background:#fff8d7 !important;
}

</style>

<div class="grid-wrapper">

<table class="grid-table">

<thead>

<tr>

${columns
  .map(
    (column) => `
<th onclick="window.sortGrid('${column}')">
    ${escapeHtml(column)}
</th>
`,
  )
  .join("")}

<th>Actions</th>

</tr>

<tr class="grid-filter-row">

${columns
  .map(
    (column) => `
<th>
    <input
        class="grid-filter"
        value="${escapeHtml(gridState.filters[column] || "")}"
        placeholder="Filter..."
        onchange="window.filterGrid('${column}', this.value)">
</th>
`,
  )
  .join("")}

<th></th>

</tr>

</thead>

<tbody>

${workingRows
  .map((row) => {
    const editing = gridState.editingRows.has(row.__rowId);

    return `

    <tr class="${editing ? "grid-row-editing" : ""}">

        ${columns
          .map((column) => {
            if (editing) {
              return `
                <td>
                    <input
                        class="grid-input"
                        value="${escapeHtml(row[column])}"
                        onchange="window.updateGridCell(
                            ${row.__rowId},
                            '${column}',
                            this.value
                        )">
                </td>
                `;
            }

            return `
            <td>
                ${escapeHtml(row[column])}
            </td>
            `;
          })
          .join("")}

        <td>

            <button
                class="grid-edit-btn"
                onclick="window.toggleGridEdit(
                    ${row.__rowId}
                )">

                ${editing ? "Lock" : "Edit"}

            </button>

        </td>

    </tr>

    `;
  })
  .join("")}

</tbody>

</table>

</div>
`;
}

function refreshGrid() {
  console.log(`attempting to update`);
  const html = buildFullTable(employeeColumns, employeeRows);
  console.log(`updating`);
  console.log(html);
  LFForm.changeFieldSettings(
    {
      fieldId: CUSTOM_HTML_FIELD_ID,
    },
    {
      HTMLContent: html,
    },
  );
}

LFForm.onFieldChange(
  async () => {
    const content = LFForm.getFieldValues({ fieldId: 3 }); // incoming JSON string
    let data;
    try {
      data = JSON.parse(content);
    } catch (e) {
      await LFForm.changeFieldSettings(
        { fieldId: 1 },
        { content: `<p>Error parsing JSON: ${escapeHtml(e.message)}</p>` },
      );
      return;
    }

    // --- Retrieve current accumulators from hidden fields ---
    let columns = [];
    const storedColumns = LFForm.getFieldValues({ fieldId: 22 });
    if (storedColumns && storedColumns.trim() !== "") {
      try {
        columns = JSON.parse(storedColumns);
      } catch (e) {}
    }

    let allRows = [];
    const storedRows = LFForm.getFieldValues({ fieldId: 23 });
    if (storedRows && storedRows.trim() !== "") {
      try {
        allRows = JSON.parse(storedRows);
      } catch (e) {}
    }

    // --- Process the new chunk ---
    const newValues = data.value || [];

    // On the first page: save the column order (ignore Cxxx fields)
    if (columns.length === 0 && newValues.length > 0) {
      columns = [
        ...new Set(
          newValues.flatMap((row) =>
            Object.keys(row).filter((key) => !/^C\d+$/i.test(key)),
          ),
        ),
      ];
      await LFForm.setFieldValues({ fieldId: 22 }, JSON.stringify(columns));
    }

    // Append new rows to the accumulator
    allRows = allRows.concat(newValues);
    await LFForm.setFieldValues({ fieldId: 23 }, JSON.stringify(allRows));

    // --- Check if there are more pages ---
    const nextLink = data["@odata.nextLink"];

    if (nextLink) {
      // More pages: set the $skip value to fetch the next chunk
      const parseSkip = nextLink.split("$skip=");
      if (parseSkip.length > 1) {
        await LFForm.setFieldValues({ fieldId: 21 }, parseSkip[1]);
      }
      // DO NOT update field 1 yet – we want the whole set
    } else {
      // Last page (or the only page): build the final table and display it
      console.log("building");
      const finalHtml = buildFullTable(columns, allRows);
      console.log(columns);
      console.log(allRows);
      employeeColumns = columns;
      employeeRows = allRows;
      console.log(finalHtml);
      await LFForm.changeFieldSettings({ fieldId: 1 }, { content: finalHtml });

      // Optional: clear accumulators so the next fresh search starts clean
      await LFForm.setFieldValues({ fieldId: 22 }, "");
      await LFForm.setFieldValues({ fieldId: 23 }, "");
    }
  },
  { fieldId: 3 },
);

LFForm.onFieldChange(
  () => {
    console.log(`updating`);
    const data = LFForm.getFieldValues({ fieldId: 26 });
    console.log(data.map((obj) => JSON.stringify(obj)).join("\n"));
    LFForm.setFieldValues(
      { fieldId: 38 },
      data.map((obj) => JSON.stringify(obj)).join("\n"),
    );
  },
  { fieldId: 37 },
);

function debounce(func, delay = 500) {
  let timeoutId;

  return function (...args) {
    // 1. Clear any existing timer to reset the delay window
    clearTimeout(timeoutId);

    // 2. Set a new timer to execute the function after the delay
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

/* ============================================================================
 * HOSTED EMPLOYEE / FLIGHT TABULATOR BRIDGE
 * This section owns iframe discovery, employee/flight payload mapping, and
 * writing saved flight assignments or deletion markers back into LFForm.
 * ========================================================================== */
function toTabulatorData(input) {
  const records = Array.isArray(input) ? input : [input];

  const componentsByRow = records.map((record) =>
    Object.values(record ?? {}).filter(
      (item) =>
        item &&
        typeof item === "object" &&
        item.settings?.label &&
        Object.hasOwn(item, "data"),
    ),
  );

  const columnMap = new Map();

  for (const components of componentsByRow) {
    for (const component of components) {
      const { label, attributeName } = component.settings;
      const field = attributeName || label;

      if (!columnMap.has(field)) {
        columnMap.set(field, { title: label, field });
      }
    }
  }

  const columns = [...columnMap.values()];
  const rows = componentsByRow.map((components) => {
    const row = Object.fromEntries(columns.map(({ field }) => [field, ""]));

    for (const component of components) {
      const field =
        component.settings.attributeName || component.settings.label;
      row[field] = component.data ?? "";
    }

    return row;
  });

  return { columns, rows };
}

const TABULATOR_ORIGIN = "https://daletools.github.io";
let tabulatorWindow = null;
let helloTimer = null;
let employeeTableReady = false;
let flightLookupReady = false;
let initialDataSent = false;

function readTableColumn(fieldId) {
  const value = LFForm.getFieldValues({ fieldId });
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function readFlightRows() {
  const fields = {
    Employee_Number: readTableColumn(51),
    Flight_Number: readTableColumn(52),
    Flight_Carrier: readTableColumn(53),
    Flight_Origin: readTableColumn(54),
    Flight_Destination: readTableColumn(55),
    Flight_Date: readTableColumn(56),
    Flight_Type: readTableColumn(57),
  };
  const rowCount = Math.max(
    0,
    ...Object.values(fields).map((values) => values.length),
  );

  return Array.from({ length: rowCount }, (_, index) =>
    Object.fromEntries(
      Object.entries(fields).map(([field, values]) => [
        field,
        values[index] ?? "",
      ]),
    ),
  );
}

function buildTabulatorPayload() {
  const employeeTable = LFForm.getFieldValues({ fieldId: 44 });
  const employeeRows = toTabulatorData(employeeTable).rows.map((row) => ({
    Employee_Number: row.Employee_Number ?? row.EmployeeNumber ?? "",
    FullName: row.FullName ?? "",
    Status: row.Status ?? "",
  }));

  return {
    type: "employee-tabulator:init",
    data: {
      employees: employeeRows,
      flights: readFlightRows(),
    },
  };
}

function sendTableToTabulator() {
  if (
    !tabulatorWindow ||
    !employeeTableReady ||
    !flightLookupReady ||
    initialDataSent
  ) {
    console.log("tabulator init deferred", {
      hasWindow: Boolean(tabulatorWindow),
      employeeTableReady,
      flightLookupReady,
      initialDataSent,
    });
    return;
  }

  const payload = buildTabulatorPayload();
  tabulatorWindow.postMessage(payload, TABULATOR_ORIGIN);
  initialDataSent = true;
  console.log("sent employee and flight data to tabulator", {
    employees: payload.data.employees.length,
    flights: payload.data.flights.length,
  });
}

async function appendFlightsToOutputTable(flights) {
  const validFlights = flights.filter((flight) => {
    const rawDate = flight.Flight_Date;
    const dateIsBlank =
      !rawDate ||
      (typeof rawDate === "object" && !rawDate.dateStr && !rawDate.timeStr);
    const deletionMarker =
      [
        flight.Flight_Number,
        flight.Flight_Carrier,
        flight.Flight_Origin,
        flight.Flight_Destination,
        flight.Flight_Type,
      ].every((value) => value == null || value === "") && dateIsBlank;

    return (
      flight.Employee_Number &&
      (deletionMarker || ["Arrival", "Departure"].includes(flight.Flight_Type))
    );
  });
  if (validFlights.length === 0) return 0;

  const existingEmployeeNumbers = LFForm.getFieldValues({ fieldId: 60 });
  const firstIndex = Array.isArray(existingEmployeeNumbers)
    ? existingEmployeeNumbers.length
    : existingEmployeeNumbers == null || existingEmployeeNumbers === ""
      ? 0
      : 1;

  await LFForm.addRow({ fieldId: 59 }, validFlights.length);

  for (let offset = 0; offset < validFlights.length; offset++) {
    const flight = validFlights[offset];
    const index = firstIndex + offset;
    const rawDate = flight.Flight_Date;
    const dateValue =
      rawDate && typeof rawDate === "object"
        ? {
            dateStr: rawDate.dateStr ?? "",
            ...(rawDate.timeStr ? { timeStr: rawDate.timeStr } : {}),
          }
        : { dateStr: String(rawDate ?? "") };

    await LFForm.setFieldValues(
      { fieldId: 60, index },
      String(flight.Employee_Number),
    );
    await LFForm.setFieldValues(
      { fieldId: 61, index },
      String(flight.Flight_Number ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: 62, index },
      String(flight.Flight_Carrier ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: 63, index },
      String(flight.Flight_Origin ?? ""),
    );
    await LFForm.setFieldValues(
      { fieldId: 64, index },
      String(flight.Flight_Destination ?? ""),
    );
    await LFForm.setFieldValues({ fieldId: 65, index }, dateValue);
    await LFForm.setFieldValues(
      { fieldId: 66, index },
      String(flight.Flight_Type),
    );
  }

  return validFlights.length;
}

window.addEventListener("message", (event) => {
  if (
    event.origin !== TABULATOR_ORIGIN ||
    event.data?.type !== "employee-tabulator:ready" ||
    !event.source
  ) {
    return;
  }

  tabulatorWindow = event.source;
  if (helloTimer !== null) {
    clearInterval(helloTimer);
    helloTimer = null;
  }
  sendTableToTabulator();
});

window.addEventListener("message", async (event) => {
  if (
    event.origin !== TABULATOR_ORIGIN ||
    event.source !== tabulatorWindow ||
    event.data?.type !== "employee-tabulator:save" ||
    !Array.isArray(event.data.flights)
  ) {
    return;
  }

  try {
    const rowsSaved = await appendFlightsToOutputTable(event.data.flights);
    event.source.postMessage(
      { type: "employee-tabulator:saved", rowsSaved },
      TABULATOR_ORIGIN,
    );
  } catch (error) {
    console.error("Could not append flights to output table", error);
    event.source.postMessage(
      {
        type: "employee-tabulator:save-error",
        message: error instanceof Error ? error.message : String(error),
      },
      TABULATOR_ORIGIN,
    );
  }
});

function sendHelloToTabulatorFrames() {
  for (let index = 0; index < window.parent.frames.length; index++) {
    try {
      window.parent.frames[index].postMessage(
        { type: "employee-tabulator:hello" },
        TABULATOR_ORIGIN,
      );
    } catch (error) {
      console.debug("Could not send tabulator hello to frame", index, error);
    }
  }
}

sendHelloToTabulatorFrames();
helloTimer = setInterval(sendHelloToTabulatorFrames, 250);

LFForm.onFieldChange(
  () => {
    employeeTableReady = true;
    sendTableToTabulator();
  },
  { fieldId: 47 },
);

LFForm.onFieldChange(
  () => {
    flightLookupReady = true;
    sendTableToTabulator();
  },
  { fieldId: 57 },
);

window.addEventListener("message", (event) => {
  console.log("message diagnostic", {
    type: event.data?.type,
    origin: event.origin,
    fromParent: event.source === window.parent,
  });
});

window.addEventListener("message", (event) => {
  console.log("bridge diagnostic", {
    origin: event.origin,
    type: event.data?.type,
    fromParent: event.source === window.parent,
    data: event.data,
  });
});

/* ================= END HOSTED EMPLOYEE / FLIGHT TABULATOR BRIDGE ============ */
