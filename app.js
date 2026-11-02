const STORAGE_KEYS = {
  history: "terraform-explorer.history",
  saved: "terraform-explorer.saved"
};
const VIEWBOX = { width: 1000, height: 620 };
const CATEGORY_COLORS = {
  Networking: "#40c5d8",
  Security: "#c5a5ff",
  Compute: "#f4b860"
};

const state = {
  resources: [],
  configurationFields: null,
  generatedTerraform: "",
  relationships: [],
  focus: null,
  path: [],
  history: [],
  saved: [],
  expanded: new Set(),
  positions: {},
  graphBounds: { minY: 0, maxY: VIEWBOX.height },
  fitZoom: 1,
  fitNextRender: true,
  userZoom: 1,
  zoomFrame: null,
  selectedSavedId: null,
  dialogAction: "save",
  dialogMappingId: null,
  mode: "mapping",
  zoom: 1,
  panX: 0,
  panY: 0
};

const elements = {
  graph: document.querySelector("#relationship-graph"),
  graphContent: document.querySelector("#graph-content"),
  graphEmpty: document.querySelector("#graph-empty"),
  graphFrame: document.querySelector("#graph-frame"),
  mapTitle: document.querySelector("#map-title"),
  resourceDetails: document.querySelector("#resource-details"),
  search: document.querySelector("#resource-search"),
  searchForm: document.querySelector("#search-form"),
  notice: document.querySelector("#notice"),
  error: document.querySelector("#error-banner"),
  historyList: document.querySelector("#history-list"),
  historyEmpty: document.querySelector("#history-empty"),
  savedList: document.querySelector("#saved-list"),
  savedEmpty: document.querySelector("#saved-empty"),
  savedCount: document.querySelector("#saved-count"),
  savedSidebarCount: document.querySelector("#saved-sidebar-count"),
  workspace: document.querySelector("#workspace"),
  savedWorkspace: document.querySelector("#saved-workspace"),
  mapPanel: document.querySelector("#map-panel"),
  detailsPanel: document.querySelector("#details-panel"),
  savedMapHost: document.querySelector("#saved-map-host"),
  exampleResources: document.querySelector("#example-resources"),
  mappingDialog: document.querySelector("#mapping-dialog"),
  mappingForm: document.querySelector("#mapping-form"),
  mappingName: document.querySelector("#mapping-name"),
  mappingDialogTitle: document.querySelector("#mapping-dialog-title"),
  mappingSubmit: document.querySelector("#submit-mapping"),
  exportTerraform: document.querySelector("#export-terraform"),
  terraformPreviewDialog: document.querySelector("#terraform-preview-dialog"),
  terraformPreview: document.querySelector("#terraform-preview"),
  terraformPreviewCode: document.querySelector("#terraform-preview-code"),
  copyTerraform: document.querySelector("#copy-terraform"),
  downloadTerraform: document.querySelector("#download-terraform")
};

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function showNotice(message) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("visible", Boolean(message));
  window.clearTimeout(showNotice.timeout);
  if (message) {
    showNotice.timeout = window.setTimeout(() => {
      elements.notice.classList.remove("visible");
    }, 3200);
  }
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    showError(`Could not read saved browser data (${error.message}). The current session can continue, but saved changes may not persist.`);
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    showError(`Could not save browser data (${error.message}). Check available storage and browser permissions.`);
  }
}

function resourceById(id) {
  return state.resources.find((resource) => resource.id === id);
}

function setFocus(id, addHistory = true) {
  const resource = resourceById(id);
  if (!resource) {
    showNotice("That resource is not in the current relationship dataset.");
    return;
  }

  state.focus = id;
  state.path = [id];
  state.expanded.clear();
  for (const group of groupConnections(getConnections(id, "incoming"), "incoming")) {
    state.expanded.add(upstreamGroupKey(id, group.category));
  }
  state.positions = {};
  state.userZoom = 1;
  state.fitNextRender = true;
  state.panX = 0;
  state.panY = 0;
  if (addHistory) addHistoryEntry(id);
  elements.search.value = id;
  elements.mapTitle.textContent = id;
  renderGraph();
  renderDetails();
  updateSelectedSavedMapping();
}

function selectPrerequisite(id, dependentId) {
  const dependentIndex = state.path.indexOf(dependentId);
  if (dependentIndex !== 0 || !state.relationships.some((relationship) => relationship.from === id && relationship.to === dependentId)) {
    showNotice("That resource is not an observed prerequisite of the current path root.");
    return;
  }

  const dependent = resourceById(dependentId);
  state.path = [id, ...state.path];

  const shiftedExpanded = new Set();
  for (const key of state.expanded) {
    const match = key.match(/^depth:(\d+):(.*)$/);
    if (match) shiftedExpanded.add(`depth:${Number(match[1]) + 1}:${match[2]}`);
  }
  for (const group of groupConnections(getConnections(id, "incoming"), "incoming")) {
    shiftedExpanded.add(upstreamGroupKey(id, group.category));
  }
  if (dependent?.category) shiftedExpanded.add(groupKey(id, dependent.category, 0));
  state.expanded = shiftedExpanded;

  const shiftedPositions = {};
  for (const [key, position] of Object.entries(state.positions)) {
    const pathMatch = key.match(/^path:(\d+):(.+)$/);
    const childMatch = key.match(/^child:(\d+):(.+)$/);
    const groupMatch = key.match(/^group:depth:(\d+):(.+)$/);
    if (pathMatch) {
      shiftedPositions[`path:${Number(pathMatch[1]) + 1}:${pathMatch[2]}`] = { ...position, y: position.y + 190 };
    } else if (childMatch) {
      shiftedPositions[`child:${Number(childMatch[1]) + 1}:${childMatch[2]}`] = { ...position, y: position.y + 190 };
    } else if (groupMatch) {
      shiftedPositions[`group:depth:${Number(groupMatch[1]) + 1}:${groupMatch[2]}`] = { ...position, y: position.y + 190 };
    }
  }
  state.positions = shiftedPositions;
  addHistoryEntry(id);
  renderGraph();
  renderDetails();
  updateSelectedSavedMapping();
}

function addHistoryEntry(id) {
  state.history = [id, ...state.history.filter((item) => item !== id)].slice(0, 12);
  writeStorage(STORAGE_KEYS.history, state.history);
  renderHistory();
}

function selectDependent(id, parentId) {
  const parentIndex = state.path.lastIndexOf(parentId);
  if (parentIndex < 0 || !state.relationships.some((relationship) => relationship.from === parentId && relationship.to === id)) {
    showNotice("That resource is not a dependant of the selected path resource.");
    return;
  }

  const existingIndex = state.path.indexOf(id);
  let retainedDepth = parentIndex;
  if (existingIndex >= 0 && existingIndex <= parentIndex) {
    state.path = state.path.slice(0, existingIndex + 1);
    state.focus = id;
    retainedDepth = existingIndex;
  } else {
    state.path = [...state.path.slice(0, parentIndex + 1), id];
    state.focus = id;
    const category = resourceById(id)?.category;
    if (category) state.expanded.add(groupKey(parentId, category, parentIndex));
  }
  for (const key of state.expanded) {
    const depth = Number(key.split(":")[1]);
    if (depth > retainedDepth) state.expanded.delete(key);
  }

  addHistoryEntry(id);
  elements.search.value = id;
  elements.mapTitle.textContent = id;
  renderGraph();
  renderDetails();
  updateSelectedSavedMapping();
}

function findResource(query) {
  const normalized = query.trim().toLowerCase();
  return state.resources.find((resource) =>
    resource.id.toLowerCase() === normalized ||
    resource.name.toLowerCase() === normalized ||
    resource.id.toLowerCase().includes(normalized)
  );
}

function getConnections(id, direction) {
  return state.relationships.filter((relationship) =>
    direction === "incoming" ? relationship.to === id : relationship.from === id
  );
}

function groupConnections(connections, direction) {
  const groups = new Map();
  for (const relationship of connections) {
    const resourceId = direction === "incoming" ? relationship.from : relationship.to;
    const resource = resourceById(resourceId);
    if (!resource) continue;
    if (!groups.has(resource.category)) groups.set(resource.category, []);
    const members = groups.get(resource.category);
    if (!members.some((member) => member.id === resourceId)) {
      members.push(resource);
    }
  }
  return [...groups.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([category, members]) => ({
      category,
      members: members.sort((first, second) => first.id.localeCompare(second.id))
    }));
}

function groupKey(parentId, category, depth) {
  return `depth:${depth}:${parentId}:${category}`;
}

function upstreamGroupKey(parentId, category) {
  return `upstream:${parentId}:${category}`;
}

function getPosition(key, fallback) {
  return state.positions[key] || fallback;
}

function svgElement(name, attributes = {}, text = "") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [attribute, value] of Object.entries(attributes)) {
    node.setAttribute(attribute, value);
  }
  if (text) node.textContent = text;
  return node;
}

function addSvgText(parent, x, y, text, className) {
  const label = svgElement("text", { x, y, class: className }, text);
  parent.append(label);
  return label;
}

function drawVerticalEdge(from, to, parent, onPath = false) {
  const edge = svgElement("path", {
    d: `M ${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y}`,
    class: `graph-edge${onPath ? " path-edge" : ""}`,
    "marker-end": `url(#${onPath ? "path-arrow" : "arrow"})`
  });
  parent.append(edge);
}

function createBubble(resource, position, { selected = false, root = false, pathIndex = -1, parentId = "", parentDepth = -1, category = "", minimized = false, direction = "outgoing" } = {}) {
  const group = svgElement("g", {
    class: `graph-node resource-node${selected ? " selected" : ""}${root ? " root-node" : ""}${pathIndex >= 0 ? " on-path" : ""}${minimized ? " minimized" : ""}`,
    transform: `translate(${position.x} ${position.y})`,
    tabindex: "0",
    role: "button",
    "aria-label": `${direction === "incoming" ? "Potential prerequisite, " : ""}${root ? "Root resource, " : ""}${resource.id}, ${resource.name}`,
    "data-resource-id": resource.id,
    "data-position-key": pathIndex >= 0
      ? `path:${pathIndex}:${resource.id}`
      : `child:${parentDepth}:${parentId}:${resource.id}`,
    "data-path-index": String(pathIndex),
    "data-parent-resource-id": parentId,
    "data-parent-depth": String(parentDepth),
    "data-group-category": category,
    "data-direction": direction,
    "data-minimized": String(minimized)
  });
  const color = CATEGORY_COLORS[resource.category] || "#40c5d8";
  const width = minimized ? 112 : 176;
  const height = minimized ? 46 : 68;
  group.append(svgElement("rect", {
    x: -width / 2, y: -height / 2, width, height, rx: height / 2,
    class: "bubble-rect",
    style: `--bubble-color:${color}`
  }));
  if (minimized) {
    addSvgText(group, 0, 4, resource.id, "bubble-id minimized-label");
    return group;
  }
  group.append(svgElement("circle", {
    cx: -69, cy: -12, r: 4, class: "bubble-indicator",
    style: `--bubble-color:${color}`
  }));
  addSvgText(group, -59, -8, resource.id, "bubble-id");
  addSvgText(group, -69, 15, resource.name, "bubble-name");
  return group;
}

function createGroupBubble(groupData, position, parentId, depth, minimized = false, direction = "outgoing") {
  const key = direction === "incoming"
    ? upstreamGroupKey(parentId, groupData.category)
    : groupKey(parentId, groupData.category, depth);
  const expanded = state.expanded.has(key);
  const selectedChild = resourceById(state.path[depth + 1]);
  const onPath = direction === "outgoing" && selectedChild?.category === groupData.category;
  const group = svgElement("g", {
    class: `graph-node category-node group-node${expanded ? " expanded" : ""}${onPath ? " on-path" : ""}${minimized ? " minimized" : ""}`,
    transform: `translate(${position.x} ${position.y})`,
    tabindex: "0",
    role: "button",
    "aria-expanded": String(expanded),
    "aria-label": `${expanded ? "Collapse" : "Expand"} ${groupData.category}, ${groupData.members.length} ${direction === "incoming" ? "potential prerequisites of" : "dependants of"} ${parentId}`,
    "data-parent-resource-id": parentId,
    "data-parent-depth": String(depth),
    "data-group-category": groupData.category,
    "data-direction": direction,
    "data-position-key": `group:${key}`,
    "data-expanded": String(expanded),
    "data-minimized": String(minimized)
  });
  const width = minimized ? 128 : 182;
  const height = minimized ? 46 : 68;
  group.append(svgElement("rect", {
    x: -width / 2, y: -height / 2, width, height, rx: 7, class: "bubble-rect"
  }));
  if (minimized) {
    addSvgText(group, 0, 4, `${groupData.category} · ${groupData.members.length}`, "group-label minimized-label");
    return group;
  }
  group.append(svgElement("circle", { cx: -68, cy: 0, r: 13, class: "group-count-circle" }));
  addSvgText(group, -68, 4, String(groupData.members.length), "group-count");
  addSvgText(group, -46, -3, groupData.category, "group-label");
  addSvgText(group, -46, 16, expanded ? "Click to collapse" : "Click to show dependants", "group-hint");
  return group;
}

function renderGraph() {
  elements.graphContent.replaceChildren();
  const collapseButton = document.querySelector("#collapse-groups");
  collapseButton.hidden = state.expanded.size === 0;
  const hasFocus = Boolean(state.focus && resourceById(state.focus));
  elements.exportTerraform.disabled = !hasFocus;
  elements.graphEmpty.hidden = hasFocus;
  elements.graph.setAttribute("aria-label", hasFocus
    ? `Dependency path from ${state.path[0]} to ${state.focus}`
    : "Select a resource to begin exploring relationships");

  if (!hasFocus) {
    state.graphBounds = { minX: 0, maxX: VIEWBOX.width, minY: 0, maxY: VIEWBOX.height };
    state.fitZoom = 1;
    state.userZoom = 1;
    state.zoom = 1;
    updateViewBox();
    return;
  }

  const descriptors = [];
  const rootIncomingGroups = groupConnections(getConnections(state.path[0], "incoming"), "incoming")
    .map((group) => ({
      ...group,
      members: group.members.filter((member) => !state.path.includes(member.id))
    }))
    .filter((group) => group.members.length > 0);
  const rootDefaultY = rootIncomingGroups.length > 0 ? 264 : 80;
  const rootPosition = getPosition(`path:0:${state.path[0]}`, { x: 500, y: rootDefaultY });
  descriptors.push({
    type: "resource",
    resource: resourceById(state.path[0]),
    position: rootPosition,
    root: true,
    selected: state.path.length === 1,
    pathIndex: 0
  });

  const nodeBounds = [{ x: rootPosition.x, y: rootPosition.y, width: 176, height: 68 }];
  const groupGap = 24;
  if (rootIncomingGroups.length > 0) {
    const groups = rootIncomingGroups.map((groupData) => {
      const key = upstreamGroupKey(state.path[0], groupData.category);
      const expanded = state.expanded.has(key);
      const memberWidths = groupData.members.map(() => 176);
      const expandedWidth = memberWidths.reduce((sum, width) => sum + width, 0)
        + Math.max(0, memberWidths.length - 1) * 18;
      return {
        groupData,
        key,
        expanded,
        width: expanded ? Math.max(182, expandedWidth) : 182,
        memberWidths
      };
    });
    const totalWidth = groups.reduce((width, group) => width + group.width, 0)
      + Math.max(0, groups.length - 1) * groupGap;
    let cursorX = 500 - totalWidth / 2;
    const groupY = rootPosition.y - 92;
    const memberY = rootPosition.y - 184;
    addSvgText(
      elements.graphContent,
      500,
      groupY - 46,
      `POTENTIAL PREREQUISITES · ${state.path[0]}`,
      "branch-heading vertical-heading"
    );

    for (const layout of groups) {
      const { groupData, key, expanded, width, memberWidths } = layout;
      const groupPosition = getPosition(`group:${key}`, { x: cursorX + width / 2, y: groupY });
      descriptors.push({
        type: "group",
        groupData,
        position: groupPosition,
        parentId: state.path[0],
        depth: -1,
        expanded,
        direction: "incoming"
      });
      nodeBounds.push({ x: groupPosition.x, y: groupPosition.y, width: 182, height: 68 });

      drawVerticalEdge(
        { x: groupPosition.x, y: groupPosition.y + 34 },
        { x: rootPosition.x, y: rootPosition.y - 34 },
        elements.graphContent
      );

      if (expanded) {
        const rowWidth = memberWidths.reduce((sum, width) => sum + width, 0)
          + Math.max(0, memberWidths.length - 1) * 18;
        let memberCursorX = groupPosition.x - rowWidth / 2;
        groupData.members.forEach((resource, index) => {
          const memberWidth = memberWidths[index];
          const positionKey = `child:-1:${state.path[0]}:${resource.id}`;
          const position = getPosition(positionKey, {
            x: memberCursorX + memberWidth / 2,
            y: memberY
          });
          memberCursorX += memberWidth + 18;
          descriptors.push({
            type: "resource",
            resource,
            position,
            parentId: state.path[0],
            parentDepth: -1,
            category: groupData.category,
            pathIndex: -1,
            selected: false,
            direction: "incoming"
          });
          nodeBounds.push({ x: position.x, y: position.y, width: memberWidth, height: 68 });
          drawVerticalEdge(
            { x: position.x, y: position.y + 34 },
            { x: groupPosition.x, y: groupPosition.y - 34 },
            elements.graphContent
          );
        });
      }
      cursorX += width + groupGap;
    }
  }

  for (let depth = 0; depth < state.path.length; depth += 1) {
    const parentId = state.path[depth];
    const parentPosition = depth === 0
      ? rootPosition
      : descriptors.find((descriptor) => descriptor.type === "resource" && descriptor.pathIndex === depth)?.position;
    if (!parentPosition) continue;

    const groups = groupConnections(getConnections(parentId, "outgoing"), "outgoing");
    if (groups.length === 0) continue;
    const parentY = rootPosition.y + depth * 190;
    const label = svgElement(
      "text",
      { x: 500, y: parentY + 46, class: "branch-heading vertical-heading", "text-anchor": "middle" },
      `DEPENDANTS OF ${parentId}`
    );
    elements.graphContent.append(label);
    const groupY = parentY + 92;
    const memberY = parentY + 184;
    const selectedChild = state.path[depth + 1];
    const selectedCategory = resourceById(selectedChild)?.category;
    const layouts = groups.map((groupData) => {
      const key = groupKey(parentId, groupData.category, depth);
      const expanded = state.expanded.has(key);
      const minimized = state.path.length > depth + 1
        && depth === state.path.length - 2
        && groupData.category !== selectedCategory;
      const memberWidths = groupData.members.map((resource) =>
        state.path.length > depth + 1 && depth === state.path.length - 2 && resource.id !== selectedChild
          ? 112
          : 176
      );
      const minimumWidth = minimized ? 128 : 182;
      const expandedWidth = memberWidths.reduce((sum, memberWidth) => sum + memberWidth, 0)
        + Math.max(0, memberWidths.length - 1) * 18;
      const width = expanded ? Math.max(minimumWidth, expandedWidth) : minimumWidth;
      return { groupData, key, expanded, width, minimized, memberWidths };
    });
    const totalWidth = layouts.reduce((width, group) => width + group.width, 0)
      + Math.max(0, layouts.length - 1) * groupGap;
    let cursorX = 500 - totalWidth / 2;

    for (const layout of layouts) {
      const { groupData, key, expanded, width, minimized: minimizedGroup, memberWidths } = layout;
      const groupPosition = getPosition(`group:${key}`, { x: cursorX + width / 2, y: groupY });
      const groupDescriptor = {
        type: "group",
        groupData,
        position: groupPosition,
        parentId,
        depth,
        expanded,
        minimized: minimizedGroup
      };
      descriptors.push(groupDescriptor);
      nodeBounds.push({ x: groupPosition.x, y: groupPosition.y, width: minimizedGroup ? 128 : 182, height: minimizedGroup ? 46 : 68 });
      drawVerticalEdge(
        { x: parentPosition.x, y: parentPosition.y + 34 },
        { x: groupPosition.x, y: groupPosition.y - (minimizedGroup ? 23 : 34) },
        elements.graphContent,
        groupData.category === selectedCategory
      );

      if (expanded) {
        const memberGap = 18;
        const rowWidth = layout.memberWidths.reduce((sum, memberWidth) => sum + memberWidth, 0)
          + Math.max(0, layout.memberWidths.length - 1) * memberGap;
        let memberCursorX = groupPosition.x - rowWidth / 2;
        groupData.members.forEach((resource, memberIndex) => {
          const previousPathIndex = state.path.indexOf(resource.id);
          if (previousPathIndex >= 0 && previousPathIndex !== depth + 1) return;
          const pathIndex = previousPathIndex === depth + 1 ? previousPathIndex : -1;
          const minimized = memberWidths[memberIndex] === 112;
          const memberWidth = memberWidths[memberIndex];
          const fallback = {
            x: memberCursorX + memberWidth / 2,
            y: memberY
          };
          memberCursorX += memberWidth + memberGap;
          const positionKey = pathIndex >= 0
            ? `path:${pathIndex}:${resource.id}`
            : `child:${depth}:${parentId}:${resource.id}`;
          const position = getPosition(positionKey, fallback);
          descriptors.push({
            type: "resource",
            resource,
            position,
            parentId,
            parentDepth: depth,
            category: groupData.category,
            pathIndex,
            selected: pathIndex >= 0 && pathIndex === state.path.length - 1,
            minimized
          });
          nodeBounds.push({
            x: position.x,
            y: position.y,
            width: memberWidth,
            height: minimized ? 46 : 68
          });
          drawVerticalEdge(
            { x: groupPosition.x, y: groupPosition.y + (minimizedGroup ? 23 : 34) },
            { x: position.x, y: position.y - (minimized ? 23 : 34) },
            elements.graphContent,
            resource.id === selectedChild
          );
        });
      }
      cursorX += width + groupGap;
    }
  }

  for (const descriptor of descriptors) {
    const node = descriptor.type === "resource"
      ? createBubble(descriptor.resource, descriptor.position, descriptor)
      : createGroupBubble(descriptor.groupData, descriptor.position, descriptor.parentId, descriptor.depth, descriptor.minimized, descriptor.direction);
    elements.graphContent.append(node);
  }
  state.graphBounds = {
    minX: Math.min(...nodeBounds.map((bounds) => bounds.x - bounds.width / 2)),
    maxX: Math.max(...nodeBounds.map((bounds) => bounds.x + bounds.width / 2)),
    minY: Math.min(...nodeBounds.map((bounds) => bounds.y - bounds.height / 2)),
    maxY: Math.max(...nodeBounds.map((bounds) => bounds.y + bounds.height / 2))
  };
  state.fitZoom = Math.min(
    1,
    VIEWBOX.width / (state.graphBounds.maxX - state.graphBounds.minX + 40),
    VIEWBOX.height / (state.graphBounds.maxY - state.graphBounds.minY + 40)
  );
  if (state.fitNextRender) {
    state.zoom = Math.min(state.userZoom, state.fitZoom);
    state.userZoom = state.zoom;
    state.fitNextRender = false;
  }
  updateViewBox();
}

function formatRelationship(relationship, direction) {
  const otherId = direction === "incoming" ? relationship.from : relationship.to;
  const other = resourceById(otherId);
  return { relationship, other, direction };
}

function renderDetails() {
  const resource = resourceById(state.focus);
  elements.resourceDetails.replaceChildren();
  if (!resource) {
    const placeholder = document.createElement("div");
    placeholder.className = "details-placeholder";
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "↖";
    const text = document.createElement("p");
    text.textContent = "Select a bubble to see its relationship details.";
    placeholder.append(icon, text);
    elements.resourceDetails.append(placeholder);
    return;
  }
  const incoming = getConnections(resource.id, "incoming").map((item) => formatRelationship(item, "incoming"));
  const outgoing = getConnections(resource.id, "outgoing").map((item) => formatRelationship(item, "outgoing"));
  const card = document.createElement("div");
  card.className = "resource-card";
  const cardTop = document.createElement("div");
  cardTop.className = "resource-card-top";
  const category = document.createElement("span");
  category.className = "category-pill";
  category.textContent = resource.category;
  const kind = document.createElement("span");
  kind.className = "kind-label";
  kind.textContent = resource.kind;
  cardTop.append(category, kind);
  const title = document.createElement("h3");
  title.textContent = resource.id;
  const description = document.createElement("p");
  description.textContent = resource.description;
  const resourceLink = document.createElement("a");
  resourceLink.className = "resource-doc-link";
  resourceLink.href = resource.url;
  resourceLink.target = "_blank";
  resourceLink.rel = "noreferrer";
  resourceLink.textContent = "Open provider documentation ↗";
  card.append(cardTop, title, description, resourceLink);
  elements.resourceDetails.append(card);

  const appendSection = (entries, direction, heading, emptyText) => {
    const section = document.createElement("section");
    section.className = "relationship-section";
    const sectionHeading = document.createElement("h3");
    sectionHeading.textContent = heading;
    const count = document.createElement("span");
    count.textContent = String(entries.length);
    sectionHeading.append(count);
    section.append(sectionHeading);
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-relationship";
      empty.textContent = emptyText;
      section.append(empty);
    } else {
      for (const { relationship, other } of entries) {
        const item = document.createElement("div");
        item.className = "relationship-item";
        const focusButton = document.createElement("button");
        focusButton.className = "relationship-focus";
        focusButton.type = "button";
        focusButton.dataset.focusId = other.id;
        focusButton.dataset.direction = direction;
        const nature = document.createElement("span");
        nature.className = "relation-type";
        nature.textContent = relationship.nature;
        const otherId = document.createElement("strong");
        otherId.textContent = other.id;
        const field = document.createElement("span");
        field.className = "relation-field";
        field.textContent = relationship.field;
        const note = document.createElement("span");
        note.className = "relation-note";
        note.textContent = relationship.note;
        const evidence = document.createElement("span");
        evidence.className = "relation-evidence";
        evidence.textContent = `${relationship.confidence || "Unrated"} confidence · ${relationship.evidence || "Provider documentation"}`;
        focusButton.append(nature, otherId, field, note, evidence);
        const source = document.createElement("a");
        source.className = "source-link";
        source.href = relationship.source;
        source.target = "_blank";
        source.rel = "noreferrer";
        source.textContent = "Provider docs ↗";
        item.append(focusButton, source);
        if (relationship.schemaSource) {
          const schemaSource = document.createElement("a");
          schemaSource.className = "source-link source-link-secondary";
          schemaSource.href = relationship.schemaSource;
          schemaSource.target = "_blank";
          schemaSource.rel = "noreferrer";
          schemaSource.textContent = "Provider schema ↗";
          item.append(schemaSource);
        }
        const moduleSources = relationship.moduleSources || (relationship.moduleSource ? [relationship.moduleSource] : []);
        for (const [index, moduleSourceUrl] of moduleSources.slice(0, 2).entries()) {
          const moduleSource = document.createElement("a");
          moduleSource.className = "source-link source-link-secondary";
          moduleSource.href = moduleSourceUrl;
          moduleSource.target = "_blank";
          moduleSource.rel = "noreferrer";
          moduleSource.textContent = moduleSources.length > 1
            ? `Public module example ${index + 1} ↗`
            : "Public module example ↗";
          item.append(moduleSource);
        }
        if (moduleSources.length > 2) {
          const moreSources = document.createElement("span");
          moreSources.className = "source-link source-link-secondary";
          moreSources.textContent = `+${moduleSources.length - 2} more samples`;
          item.append(moreSources);
        }
        section.append(item);
      }
    }
    elements.resourceDetails.append(section);
  };
  appendSection(incoming, "incoming", "Input references", "No incoming references in the sampled map.");
  appendSection(outgoing, "outgoing", "Referenced by", "No outgoing references in the sampled map.");

  const caveat = document.createElement("p");
  caveat.className = "data-caveat";
  caveat.textContent = "These are documented argument references and observed patterns, not guaranteed Terraform graph edges. Required inputs can come from variables or data sources; configuration expressions determine actual dependencies.";
  elements.resourceDetails.append(caveat);
}

function renderHistory() {
  elements.historyList.replaceChildren();
  elements.historyEmpty.hidden = state.history.length > 0;
  for (const id of state.history) {
    const resource = resourceById(id);
    if (!resource) continue;
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = `history-item${id === state.focus ? " current" : ""}`;
    button.type = "button";
    button.dataset.focusId = id;
    const dot = document.createElement("span");
    dot.className = "history-dot";
    const labels = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = resource.id;
    const name = document.createElement("small");
    name.textContent = resource.name;
    labels.append(title, name);
    const arrow = document.createElement("span");
    arrow.className = "history-arrow";
    arrow.textContent = "↗";
    button.append(dot, labels, arrow);
    item.append(button);
    elements.historyList.append(item);
  }
}

function openMappingDialog(action, id = null) {
  if (action === "save" && !state.focus) {
    showNotice("Choose a resource before saving a mapping.");
    return;
  }
  const mapping = state.saved.find((item) => item.id === id);
  if (action === "rename" && !mapping) {
    showError("Could not rename the saved mapping because it no longer exists.");
    return;
  }
  state.dialogAction = action;
  state.dialogMappingId = id;
  elements.mappingDialogTitle.textContent = action === "rename" ? "Rename mapping" : "Save mapping";
  elements.mappingSubmit.textContent = action === "rename" ? "Save name" : "Save mapping";
  elements.mappingName.value = mapping ? mapping.name : state.focus;
  elements.mappingDialog.showModal();
  elements.mappingName.focus();
}

function submitMapping(event) {
  event.preventDefault();
  const normalizedName = elements.mappingName.value.trim();
  if (!normalizedName) {
    elements.mappingName.setCustomValidity("Enter a name for this mapping.");
    elements.mappingName.reportValidity();
    return;
  }
  elements.mappingName.setCustomValidity("");

  if (state.dialogAction === "rename") {
    const mapping = state.saved.find((item) => item.id === state.dialogMappingId);
    if (!mapping) {
      showError("Could not rename the saved mapping because it no longer exists.");
      elements.mappingDialog.close();
      return;
    }
    mapping.name = normalizedName;
    persistSaved();
    renderSavedList();
    showNotice(`Renamed mapping to "${normalizedName}".`);
    elements.mappingDialog.close();
    return;
  }

  const savedMapping = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: normalizedName,
    focus: state.focus,
    path: [...state.path],
    expanded: [...state.expanded],
    positions: { ...state.positions },
    updatedAt: new Date().toISOString()
  };
  state.saved = [savedMapping, ...state.saved];
  state.selectedSavedId = savedMapping.id;
  persistSaved();
  renderSavedList();
  showNotice(`Saved "${normalizedName}".`);
  elements.mappingDialog.close();
}

function persistSaved() {
  writeStorage(STORAGE_KEYS.saved, state.saved);
  renderSavedCount();
}

function renderSavedCount() {
  const count = String(state.saved.length);
  elements.savedCount.textContent = count;
  elements.savedSidebarCount.textContent = count;
}

function renderSavedList() {
  elements.savedList.replaceChildren();
  elements.savedEmpty.hidden = state.saved.length > 0;
  for (const [index, mapping] of state.saved.entries()) {
    const item = document.createElement("li");
    item.className = `saved-item${mapping.id === state.selectedSavedId ? " selected" : ""}`;
    const open = document.createElement("button");
    open.className = "saved-item-open";
    open.type = "button";
    open.dataset.savedId = mapping.id;
    const resource = resourceById(mapping.focus);
    const icon = document.createElement("span");
    icon.className = "saved-item-icon";
    icon.textContent = "◇";
    const labels = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = mapping.name;
    const subtitle = document.createElement("small");
    subtitle.textContent = `${mapping.focus}${resource ? ` · ${resource.name}` : ""}`;
    labels.append(title, subtitle);
    open.append(icon, labels);
    const actions = document.createElement("div");
    actions.className = "saved-item-actions";
    for (const [action, label, symbol, disabled] of [
      ["up", "Move up", "↑", index === 0],
      ["down", "Move down", "↓", index === state.saved.length - 1],
      ["rename", "Rename", "✎", false],
      ["delete", "Delete", "×", false]
    ]) {
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = `mini-button${action === "delete" ? " danger-button" : ""}`;
      actionButton.dataset.action = action;
      actionButton.dataset.savedId = mapping.id;
      actionButton.setAttribute("aria-label", `${label} ${mapping.name}`);
      actionButton.disabled = disabled;
      actionButton.textContent = symbol;
      actions.append(actionButton);
    }
    item.append(open, actions);
    elements.savedList.append(item);
  }
}

function selectSavedMapping(id) {
  const mapping = state.saved.find((item) => item.id === id);
  if (!mapping) return;
  if (!resourceById(mapping.focus)) {
    showError(`The saved mapping "${mapping.name}" points to an unknown resource.`);
    return;
  }
  const path = getSavedPath(mapping);
  if (!path) return;
  state.selectedSavedId = mapping.id;
  state.focus = mapping.focus;
  state.path = path;
  state.expanded = new Set(mapping.expanded || []);
  state.positions = { ...(mapping.positions || {}) };
  state.userZoom = 1;
  state.zoom = 1;
  state.fitNextRender = true;
  state.panX = 0;
  state.panY = 0;
  elements.search.value = mapping.focus;
  elements.mapTitle.textContent = mapping.focus;
  renderGraph();
  renderDetails();
  elements.savedMapHost.append(elements.mapPanel, elements.detailsPanel);
  document.querySelector("#saved-preview-empty").hidden = true;
  renderSavedList();
}

function getSavedPath(mapping) {
  const path = Array.isArray(mapping.path) ? mapping.path : [mapping.focus];
  const valid = path.length > 0
    && path[path.length - 1] === mapping.focus
    && path.every((id) => resourceById(id))
    && path.slice(1).every((id, index) =>
      state.relationships.some((relationship) => relationship.from === path[index] && relationship.to === id)
    );
  if (!valid) {
    showError(`The saved mapping "${mapping.name}" contains an invalid dependency path.`);
    return null;
  }
  return path;
}

function updateSelectedSavedMapping() {
  const mapping = state.saved.find((item) => item.id === state.selectedSavedId);
  if (!mapping || state.mode !== "saved") return;
  mapping.focus = state.focus;
  mapping.path = [...state.path];
  mapping.expanded = [...state.expanded];
  mapping.positions = { ...state.positions };
  mapping.updatedAt = new Date().toISOString();
  persistSaved();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-button").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const savedMode = mode === "saved";
  elements.workspace.hidden = savedMode;
  elements.savedWorkspace.hidden = !savedMode;
  if (savedMode) {
    if (state.selectedSavedId) {
      const mapping = state.saved.find((item) => item.id === state.selectedSavedId);
      if (!mapping || !resourceById(mapping.focus)) {
        if (mapping) showError(`The saved mapping "${mapping.name}" points to an unknown resource.`);
        state.selectedSavedId = null;
      } else {
        const path = getSavedPath(mapping);
        if (!path) {
          state.selectedSavedId = null;
        } else {
          state.focus = mapping.focus;
          state.path = path;
          state.expanded = new Set(mapping.expanded || []);
          state.positions = { ...(mapping.positions || {}) };
          state.userZoom = 1;
          state.panX = 0;
          state.panY = 0;
          elements.search.value = mapping.focus;
          elements.mapTitle.textContent = mapping.focus;
          renderGraph();
          renderDetails();
        }
      }
    }
    if (state.selectedSavedId) {
      elements.savedMapHost.append(elements.mapPanel, elements.detailsPanel);
      document.querySelector("#saved-preview-empty").hidden = true;
    } else {
      elements.savedMapHost.replaceChildren(document.querySelector("#saved-preview-empty"));
      document.querySelector("#saved-preview-empty").hidden = false;
    }
  } else {
    elements.workspace.append(elements.mapPanel, elements.detailsPanel);
  }
  renderSavedList();
}

function updateViewBox() {
  const width = VIEWBOX.width / state.zoom;
  const height = VIEWBOX.height / state.zoom;
  const centerX = (state.graphBounds.minX + state.graphBounds.maxX) / 2;
  const centerY = (state.graphBounds.minY + state.graphBounds.maxY) / 2;
  const x = centerX - width / 2 + state.panX;
  const y = centerY - height / 2 + state.panY;
  elements.graph.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
}

function renderTerraformFields(fields, indentation = "  ") {
  const lines = [];
  for (const field of fields || []) {
    if (Array.isArray(field.fields)) {
      if (field.block) {
        lines.push(`${indentation}# ${field.required ? "REQUIRED" : "Optional"} block example`);
        lines.push(`${indentation}${field.name} {`);
        lines.push(...renderTerraformFields(field.fields, `${indentation}  `));
        lines.push(`${indentation}}`);
      } else {
        const mode = field.nestingMode;
        const isCollection = mode === "list" || mode === "set";
        const isMap = mode === "map";
        lines.push(`${indentation}${field.name} = ${isCollection ? "[{" : "{"}`);
        if (isMap) lines.push(`${indentation}  example = {`);
        const childIndentation = isMap ? `${indentation}    ` : `${indentation}  `;
        lines.push(...renderTerraformFields(field.fields, childIndentation));
        if (field.nestingMode === "map") lines.push(`${indentation}  }`);
        lines.push(`${indentation}${isCollection ? "}]" : "}"}`);
      }
      continue;
    }

    const value = field.required ? '"REQUIRED"' : "null";
    lines.push(`${indentation}${field.name} = ${value}`);
  }
  return lines;
}

function formatTerraformLines(lines) {
  const formatted = [...lines];
  for (let start = 0; start < formatted.length;) {
    const first = formatted[start].match(/^(\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*=/);
    if (!first) {
      start += 1;
      continue;
    }

    const indentation = first[1];
    let end = start;
    let maxNameLength = 0;
    while (end < formatted.length) {
      const assignment = formatted[end].match(/^(\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*=/);
      if (!assignment || assignment[1] !== indentation) break;
      maxNameLength = Math.max(maxNameLength, assignment[2].length);
      end += 1;
    }

    for (let index = start; index < end; index += 1) {
      formatted[index] = formatted[index].replace(
        /^(\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*=/,
        (_, prefix, name) => `${prefix}${name.padEnd(maxNameLength)} =`
      );
    }
    start = end;
  }
  return formatted;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function highlightTerraform(source) {
  const tokenPattern = /#[^\n]*|"(?:\\.|[^"\\])*"|\b(?:resource|data|module|variable|locals|terraform|provider|output|dynamic|for_each|depends_on|for|in|if|else)\b|\b(?:true|false|null)\b|\b\d+(?:\.\d+)?\b|[A-Za-z_][A-Za-z0-9_-]*(?=\s*=)|[{}[\](),.]|[A-Za-z_][A-Za-z0-9_-]*/g;
  const classes = (token) => {
    if (token.startsWith("#")) return "hcl-comment";
    if (token.startsWith("\"")) return "hcl-string";
    if (/^(resource|data|module|variable|locals|terraform|provider|output|dynamic|for_each|depends_on|for|in|if|else)$/.test(token)) return "hcl-keyword";
    if (/^(true|false|null)$/.test(token)) return "hcl-literal";
    if (/^\d/.test(token)) return "hcl-number";
    if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(token)) return "hcl-identifier";
    return "hcl-punctuation";
  };
  let html = "";
  let previousIndex = 0;
  for (const match of source.matchAll(tokenPattern)) {
    const index = match.index;
    const token = match[0];
    html += escapeHtml(source.slice(previousIndex, index));
    html += `<span class="${classes(token)}">${escapeHtml(token)}</span>`;
    previousIndex = index + token.length;
  }
  return html + escapeHtml(source.slice(previousIndex));
}

async function exportTerraform() {
  const pathResources = state.path.map(resourceById);
  if (pathResources.length === 0 || pathResources.some((resource) => !resource)) {
    showNotice("Select a valid resource path before exporting Terraform.");
    return;
  }

  if (!state.configurationFields) {
    const response = await fetch("./data/configuration-fields.json");
    if (!response.ok) {
      throw new Error(`Could not load resource field schemas (${response.status} ${response.statusText}).`);
    }
    state.configurationFields = await response.json();
  }

  const lines = [
    "# Generated from the selected resource path.",
    "# Replace each \"REQUIRED\" placeholder before planning or applying.",
    "# Optional null values are included as editable examples.",
    "# Schema source: HashiCorp AWS provider v6.0.0.",
    ""
  ];
  for (const resource of pathResources) {
    const fields = state.configurationFields[resource.id];
    if (!Array.isArray(fields)) {
      throw new Error(`No configurable field schema was found for ${resource.id}.`);
    }
    lines.push(`resource "${resource.id}" "${resource.id}_example" {`);
    lines.push(...renderTerraformFields(fields));
    lines.push("}", "");
  }

  state.generatedTerraform = `${formatTerraformLines(lines).join("\n").trimEnd()}\n`;
  elements.terraformPreviewCode.innerHTML = highlightTerraform(state.generatedTerraform);
  elements.terraformPreviewDialog.showModal();
  elements.terraformPreview.focus();
}

function downloadTerraform() {
  const pathResources = state.path.map(resourceById);
  if (pathResources.length === 0 || pathResources.some((resource) => !resource)) {
    showNotice("Select a valid resource path before downloading Terraform.");
    elements.terraformPreviewDialog.close();
    return;
  }
  const blob = new Blob([state.generatedTerraform], { type: "text/plain;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `${pathResources[0].id}-to-${pathResources[pathResources.length - 1].id}.tf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  elements.terraformPreviewDialog.close();
  showNotice(`Downloaded Terraform boilerplate for ${pathResources.length} selected resource${pathResources.length === 1 ? "" : "s"}.`);
}

async function copyTerraform() {
  try {
    await navigator.clipboard.writeText(state.generatedTerraform);
    showNotice("Terraform boilerplate copied to the clipboard.");
  } catch (error) {
    showError(`Could not copy Terraform boilerplate to the clipboard (${error.message}). Select the preview text and copy it manually.`);
  }
}

function setZoom(nextZoom) {
  state.userZoom = Math.max(0.25, Math.min(1.7, nextZoom));
  if (state.zoomFrame !== null) return;

  const animate = () => {
    const difference = state.userZoom - state.zoom;
    if (Math.abs(difference) < 0.001) {
      state.zoom = state.userZoom;
      state.zoomFrame = null;
      updateViewBox();
      return;
    }
    state.zoom += difference * 0.76;
    updateViewBox();
    state.zoomFrame = window.requestAnimationFrame(animate);
  };
  state.zoomFrame = window.requestAnimationFrame(animate);
}

function graphPoint(event) {
  const point = elements.graph.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(elements.graph.getScreenCTM().inverse());
}

function saveGraphLayout() {
  updateSelectedSavedMapping();
}

function initializeEvents() {
  elements.exportTerraform.addEventListener("click", async () => {
    try {
      await exportTerraform();
    } catch (error) {
      showError(`Could not prepare Terraform boilerplate (${error.message}).`);
    }
  });
  elements.copyTerraform.addEventListener("click", copyTerraform);
  elements.downloadTerraform.addEventListener("click", downloadTerraform);
  document.querySelector("#close-terraform-preview").addEventListener("click", () => {
    elements.terraformPreviewDialog.close();
  });

  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const resource = findResource(elements.search.value);
    if (!resource) {
      showNotice("No matching resource found. Choose an AWS resource from the suggestions.");
      return;
    }
    if (state.mode !== "mapping") setMode("mapping");
    setFocus(resource.id);
  });

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  elements.graphContent.addEventListener("click", (event) => {
    const node = event.target.closest(".graph-node");
    if (!node) return;
    if (node.dataset.resourceId) {
      const pathIndex = Number(node.dataset.pathIndex);
      if (pathIndex >= 0) {
        if (pathIndex < state.path.length - 1) {
          state.path = state.path.slice(0, pathIndex + 1);
          state.focus = node.dataset.resourceId;
          for (const key of state.expanded) {
            if (Number(key.split(":")[1]) > pathIndex) state.expanded.delete(key);
          }
          addHistoryEntry(state.focus);
          elements.search.value = state.focus;
          elements.mapTitle.textContent = state.focus;
          renderGraph();
          renderDetails();
          saveGraphLayout();
        }
        return;
      }
      if (node.dataset.direction === "incoming") {
        selectPrerequisite(node.dataset.resourceId, node.dataset.parentResourceId);
      } else {
        selectDependent(node.dataset.resourceId, node.dataset.parentResourceId);
      }
      return;
    }
    const parentId = node.dataset.parentResourceId;
    const depth = Number(node.dataset.parentDepth);
    const direction = node.dataset.direction;
    const key = direction === "incoming"
      ? upstreamGroupKey(parentId, node.dataset.groupCategory)
      : groupKey(parentId, node.dataset.groupCategory, depth);
    if (state.expanded.has(key)) {
      state.expanded.delete(key);
      if (direction === "outgoing") {
        const selectedChild = resourceById(state.path[depth + 1]);
        if (state.path.length > depth + 1 && selectedChild?.category === node.dataset.groupCategory) {
          state.path = state.path.slice(0, depth + 1);
          state.focus = parentId;
          elements.search.value = state.focus;
          elements.mapTitle.textContent = state.focus;
          renderDetails();
        }
        for (const expandedKey of state.expanded) {
          if (expandedKey.startsWith("depth:") && Number(expandedKey.split(":")[1]) > depth) {
            state.expanded.delete(expandedKey);
          }
        }
      }
    } else {
      state.expanded.add(key);
    }
    renderGraph();
    saveGraphLayout();
  });

  elements.graphContent.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const node = event.target.closest(".graph-node");
    if (!node) return;
    event.preventDefault();
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  document.querySelector("#collapse-groups").addEventListener("click", () => {
    if (state.expanded.size === 0) return;
    state.path = state.path.length ? [state.path[0]] : [];
    state.focus = state.path[0] || null;
    state.expanded.clear();
    state.positions = {};
    if (state.focus) {
      elements.search.value = state.focus;
      elements.mapTitle.textContent = state.focus;
      renderDetails();
    }
    renderGraph();
    saveGraphLayout();
  });

  elements.graphContent.addEventListener("pointerdown", (event) => {
    const node = event.target.closest(".graph-node");
    if (!node || event.button !== 0) return;
    event.preventDefault();
    const initialPoint = graphPoint(event);
    const initialTransform = node.transform.baseVal.consolidate().matrix;
    const start = { x: initialTransform.e, y: initialTransform.f };
    const key = node.dataset.positionKey;
    let moved = false;
    node.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      const current = graphPoint(moveEvent);
      const dx = current.x - initialPoint.x;
      const dy = current.y - initialPoint.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) node.setAttribute("transform", `translate(${start.x + dx} ${start.y + dy})`);
    };
    const finish = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", finish);
      node.removeEventListener("pointercancel", finish);
      if (!moved) return;
      const transform = node.transform.baseVal.consolidate().matrix;
      state.positions[key] = { x: transform.e, y: transform.f };
      if (node.dataset.parentResourceId && node.dataset.expanded === "true") {
        const parentId = node.dataset.parentResourceId;
        const depth = Number(node.dataset.parentDepth);
        const direction = node.dataset.direction === "incoming" ? "incoming" : "outgoing";
        const connections = groupConnections(getConnections(parentId, direction), direction);
        const groupData = connections.find((group) => group.category === node.dataset.groupCategory);
        const deltaX = transform.e - start.x;
        const deltaY = transform.f - start.y;
        for (const resource of groupData?.members || []) {
          const member = [...elements.graphContent.querySelectorAll(".graph-node[data-resource-id]")]
            .find((candidate) =>
              candidate.dataset.resourceId === resource.id
              && candidate.dataset.parentResourceId === parentId
              && Number(candidate.dataset.parentDepth) === depth
              && candidate.dataset.direction === direction
            );
          if (!member) continue;
          const memberPosition = member.transform.baseVal.consolidate().matrix;
          state.positions[member.dataset.positionKey] = {
            x: memberPosition.e + deltaX,
            y: memberPosition.f + deltaY
          };
        }
      }
      renderGraph();
      saveGraphLayout();
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", finish);
    node.addEventListener("pointercancel", finish);
  });

  elements.graph.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".graph-node") || event.button !== 0 || !state.focus) return;
    const start = graphPoint(event);
    const initial = { x: state.panX, y: state.panY };
    const move = (moveEvent) => {
      const current = graphPoint(moveEvent);
      state.panX = initial.x - (current.x - start.x);
      state.panY = initial.y - (current.y - start.y);
      updateViewBox();
    };
    const finish = () => {
      elements.graph.removeEventListener("pointermove", move);
      elements.graph.removeEventListener("pointerup", finish);
      elements.graph.removeEventListener("pointercancel", finish);
    };
    elements.graph.setPointerCapture(event.pointerId);
    elements.graph.addEventListener("pointermove", move);
    elements.graph.addEventListener("pointerup", finish);
    elements.graph.addEventListener("pointercancel", finish);
  });

  elements.graph.addEventListener("wheel", (event) => {
    if (!state.focus) return;
    event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? VIEWBOX.height : 1;
    const delta = Math.max(-120, Math.min(120, event.deltaY * unit));
    setZoom(state.userZoom * Math.exp(-delta * 0.0009));
  }, { passive: false });

  document.querySelector("#zoom-in").addEventListener("click", () => setZoom(state.userZoom * 1.112));
  document.querySelector("#zoom-out").addEventListener("click", () => setZoom(state.userZoom / 1.112));
  document.querySelector("#center-map").addEventListener("click", () => {
    state.userZoom = Math.min(1, state.fitZoom);
    setZoom(state.userZoom);
    state.panX = 0;
    state.panY = 0;
    updateViewBox();
  });
  document.querySelector("#save-button").addEventListener("click", () => openMappingDialog("save"));
  document.querySelector("#cancel-mapping").addEventListener("click", () => elements.mappingDialog.close());
  elements.mappingForm.addEventListener("submit", submitMapping);
  elements.mappingName.addEventListener("input", () => elements.mappingName.setCustomValidity(""));
  document.querySelector("#reset-button").addEventListener("click", () => {
    state.focus = null;
    state.path = [];
    state.expanded.clear();
    state.positions = {};
    state.userZoom = 1;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    elements.search.value = "";
    elements.mapTitle.textContent = "Select a resource to begin";
    renderGraph();
    renderDetails();
    showNotice("Map reset. Your history and saved mappings are unchanged.");
  });
  document.querySelector("#clear-history").addEventListener("click", () => {
    state.history = [];
    writeStorage(STORAGE_KEYS.history, state.history);
    renderHistory();
  });
  document.querySelector("#go-to-mapping").addEventListener("click", () => setMode("mapping"));

  elements.historyList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-focus-id]");
    if (button) setFocus(button.dataset.focusId);
  });
  elements.resourceDetails.addEventListener("click", (event) => {
    const link = event.target.closest("[data-stop-focus]");
    if (link) {
      event.stopPropagation();
      return;
    }
    const button = event.target.closest("[data-focus-id]");
    if (!button) return;
    if (button.dataset.direction === "outgoing") {
      selectDependent(button.dataset.focusId, state.focus);
    } else {
      setFocus(button.dataset.focusId);
    }
  });

  elements.savedList.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const index = state.saved.findIndex((mapping) => mapping.id === actionButton.dataset.savedId);
      if (index < 0) return;
      const action = actionButton.dataset.action;
      if (action === "rename") {
        openMappingDialog("rename", state.saved[index].id);
        return;
      } else if (action === "delete") {
        const [removed] = state.saved.splice(index, 1);
        if (state.selectedSavedId === removed.id) state.selectedSavedId = null;
      } else {
        const target = action === "up" ? index - 1 : index + 1;
        if (target < 0 || target >= state.saved.length) return;
        [state.saved[index], state.saved[target]] = [state.saved[target], state.saved[index]];
      }
      persistSaved();
      renderSavedList();
      if (state.mode === "saved" && !state.selectedSavedId) setMode("saved");
      return;
    }
    const savedItem = event.target.closest("[data-saved-id]");
    if (savedItem) selectSavedMapping(savedItem.dataset.savedId);
  });

  elements.exampleResources.addEventListener("click", (event) => {
    const button = event.target.closest("[data-focus-id]");
    if (button) setFocus(button.dataset.focusId);
  });
}

function initializeData(data) {
  if (!Array.isArray(data.resources) || !Array.isArray(data.relationships)) {
    throw new Error("Relationship data must include resources and relationships lists.");
  }
  state.resources = data.resources;
  state.relationships = data.relationships.filter((relationship) =>
    resourceById(relationship.from) && resourceById(relationship.to)
  );

  const options = document.querySelector("#resource-options");
  for (const resource of state.resources) {
    const option = document.createElement("option");
    option.value = resource.id;
    option.label = `${resource.name} · ${resource.category}`;
    options.append(option);
  }
  for (const id of ["aws_vpc", "aws_subnet", "aws_instance", "aws_security_group"]) {
    const resource = resourceById(id);
    if (!resource) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "example-chip";
    button.dataset.focusId = id;
    button.textContent = id;
    elements.exampleResources.append(button);
  }

  const storedHistory = readStorage(STORAGE_KEYS.history, []);
  const storedSaved = readStorage(STORAGE_KEYS.saved, []);
  state.history = Array.isArray(storedHistory) ? storedHistory.filter((id) => resourceById(id)).slice(0, 12) : [];
  state.saved = Array.isArray(storedSaved) ? storedSaved.filter((item) =>
    item && typeof item.id === "string" && typeof item.name === "string" && typeof item.focus === "string"
  ) : [];
  renderHistory();
  renderSavedCount();
  renderSavedList();
  renderGraph();
}

async function start() {
  initializeEvents();
  try {
    const response = await fetch("./data/relationships.json");
    if (!response.ok) throw new Error(`Could not load relationship data (${response.status} ${response.statusText}).`);
    const data = await response.json();
    initializeData(data);
  } catch (error) {
    showError(`${error.message} Start this app through Docker or a local web server; opening index.html directly will not load the data file.`);
    elements.graphEmpty.innerHTML = "<strong>Relationship data could not be loaded.</strong><span>Check the local server and reload the page.</span>";
  }
}

start();
