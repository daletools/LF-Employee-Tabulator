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

function sendTableToTabulator() {
  const table = LFForm.getFieldValues({ fieldId: 44 });
  if (!table || !tabulatorWindow) {
    console.log(`no table or tabulator window`);
    console.log(tabulatorWindow);
    return;
  }

  const { columns, rows } = toTabulatorData(table);

  console.log(`posting message`);

  tabulatorWindow.postMessage(
    {
      type: "employee-tabulator:init",
      columns,
      rows,
    },
    TABULATOR_ORIGIN,
  );
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
  sendTableToTabulator();
});

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

LFForm.onFieldChange(
  () => {
    console.log(`posting message`);
    sendTableToTabulator();
  },
  { fieldId: 47 },
);
