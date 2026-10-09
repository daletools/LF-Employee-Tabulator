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
let requestTabulatorWindow = null;
let helloTimer = null;
let employeeTableReady = false;
let flightLookupReady = false;
let farmTableReady = false;
let initialDataSent = false;
let requestDataSent = false;

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

function readEmployeeRows() {
  const employeeTable = LFForm.getFieldValues({ fieldId: 44 });
  return toTabulatorData(employeeTable).rows.map((row) => ({
    Employee_Number: row.Employee_Number ?? row.EmployeeNumber ?? "",
    FullName: row.FullName ?? "",
    Status: row.Status ?? "",
  }));
}

function buildTabulatorPayload() {
  const employeeRows = readEmployeeRows();

  return {
    type: "employee-tabulator:init",
    view: "flights",
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

function buildEmployeeRequestPayload() {
  const farmValues = LFForm.getFieldValues({ fieldId: 70 });
  const farms = [
    ...new Set(
      (Array.isArray(farmValues) ? farmValues : [farmValues])
        .map((farm) => {
          if (typeof farm === "string") return farm.trim();
          if (!farm || typeof farm !== "object") return "";
          return String(
            farm.Farm ??
              farm.Farm_Name ??
              farm.Name ??
              farm.data ??
              farm.value ??
              "",
          ).trim();
        })
        .filter(Boolean),
    ),
  ];

  return {
    type: "employee-tabulator:init",
    view: "employee-request",
    data: {
      employees: readEmployeeRows(),
      farms,
      requests: [],
    },
  };
}

function sendEmployeeRequestsToTabulator() {
  if (
    !requestTabulatorWindow ||
    !employeeTableReady ||
    !farmTableReady ||
    requestDataSent
  )
    return;

  const payload = buildEmployeeRequestPayload();
  requestTabulatorWindow.postMessage(payload, TABULATOR_ORIGIN);
  requestDataSent = true;
  console.log("sent employee request data to tabulator", {
    employees: payload.data.employees.length,
    farms: payload.data.farms.length,
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

  if (event.data.view === "employee-request") {
    requestTabulatorWindow = event.source;
    sendEmployeeRequestsToTabulator();
  } else {
    tabulatorWindow = event.source;
    sendTableToTabulator();
  }

  if (tabulatorWindow && requestTabulatorWindow && helloTimer !== null) {
    clearInterval(helloTimer);
    helloTimer = null;
  }
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

window.addEventListener("message", (event) => {
  if (
    event.origin !== TABULATOR_ORIGIN ||
    event.source !== requestTabulatorWindow ||
    event.data?.type !== "employee-request:save" ||
    !Array.isArray(event.data.requests)
  ) {
    return;
  }

  window.employeeRequestChanges = event.data.requests;
  console.log(
    "received employee request updates",
    window.employeeRequestChanges,
  );
  event.source.postMessage(
    {
      type: "employee-request:saved",
      rowsSaved: window.employeeRequestChanges.length,
    },
    TABULATOR_ORIGIN,
  );
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
    sendEmployeeRequestsToTabulator();
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

LFForm.onFieldChange(
  () => {
    farmTableReady = true;
    sendEmployeeRequestsToTabulator();
  },
  { fieldId: 70 },
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
