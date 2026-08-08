#!/usr/bin/env python3
"""Extract the Research Hub's UI structure from the Qt app, page by page.

Rebuilding the hub page by page from memory was leaving differences nobody
could enumerate -- "there are too many differences" is exactly the complaint you
get when the target is a 1.2M-line file and the method is reading it by hand.

So read it mechanically. `app_qt.py` builds its UI with literal strings:
`PageHeader("Title", "Subtitle")`, `.addTab(w, "Name")`,
`CollapsibleSection("Title")`, `QPushButton("Label")`,
`.setPlaceholderText("...")`, `.setHorizontalHeaderLabels([...])`,
`.addItems([...])`. Parsing the AST gives a faithful inventory of what each page
actually contains, which is a thing the web hub can be diffed against and
generated from.

    python3 GeoID_GIS/services/qt-extract.py            # write the spec
    python3 GeoID_GIS/services/qt-extract.py --summary  # what was found

Output: GeoID_GIS/viewer/gis/research/qt-spec.json

What this deliberately does NOT do is extract behaviour. The spec is the
*shape* -- titles, tabs, sections, field labels, placeholders, button labels,
table headers, dropdown options. What each button does still has to be written,
and pretending otherwise would produce a hub full of controls that look right
and do nothing.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
from pathlib import Path

QT_APP = Path("/home/owen/atlas-ai/apps/GeoID_Research/app_qt.py")
OUT = Path(__file__).resolve().parents[1] / "viewer/gis/research/qt-spec.json"

# Class name -> the page id used in stages.js. Only pages the hub declares.
# A class serving several pages (the ingest domains) maps to a list.
PAGE_CLASSES = {
    "DashboardPage": "Dashboard",
    "GeoIDProjectsPage": "Projects",
    "ProjectBoardPage": "Project Board",
    "GeoIDNotesPage": "Research Notes",
    "IngestDomainPage": "Ingest Generic Import",
    "MetadataLineagePage": "Metadata & Lineage",
    "AITrainerPage": "AI Trainer",
    "FeatureEngineeringPage": "Feature Engineering",
    "WorkflowAutomationPage": "Workflow Automation",
    "GeoIDDataRepoPage": "Data Repository",
    "QAQCPage": "QA / QC",
    "PreprocessingTransformsPage": "Preprocessing Transforms",
    "XYZToSTLPage": "XYZ to STL",
    "TemporalToolsPage": "Temporal Tools",
    "RasterToolsPage": "Raster Tools",
    "VectorToolsPage": "Vector Tools",
    "GeoIDPlotPage": "CSV Plotter",
    "MeshPage": "Mesh",
    "InputsPage": "Inputs",
    "ClonePage": "Import / Clone",
    "GuidedBuildPage": "Build New",
    "SetupPage": "Setup",
    "PropertiesPage": "Properties",
    "ICBCPage": "IC/BC",
    "SimulationPage": "Simulation",
    "DOFWizardPage": "DOF Wizard",
    "PostProcessingPage": "Post Processing",
    "SignalProcessingPage": "Signal Processing",
    "EquationWorkbenchPage": "Equation Workbench",
    "StatisticsPage": "Statistics",
    "EDAReportPage": "EDA Report",
    "PointCloud3DPage": "Point Cloud 3D",
    "DataHubPage": "Data Hub",
    "StoryboardPage": "Storyboard",
    "SettingsPage": "Settings",
    "PluginManagerPage": "Plugin Manager",
    "CustomModuleBuilderPage": "Module Builder",
    "DataPullerPage": "Ingest Generic Import",
    "DocsSheetsPage": "Docs & Sheets",
}

INPUT_WIDGETS = {"QLineEdit", "QPlainTextEdit", "QTextEdit", "QSpinBox",
                 "QDoubleSpinBox", "QComboBox", "QCheckBox", "QSlider",
                 "QDateEdit", "QListWidget", "QTableWidget", "QTreeWidget"}


def literal(node):
    """A string literal, or None."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def literal_list(node):
    if isinstance(node, (ast.List, ast.Tuple)):
        out = [literal(e) for e in node.elts]
        return [v for v in out if v is not None]
    return []


def call_name(node):
    """`QtWidgets.QPushButton` -> 'QPushButton'; `foo.setText` -> 'setText'."""
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return ""


def receiver(node):
    """For `self.name.setPlaceholderText(...)`, the receiver 'name'."""
    func = node.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Attribute):
        return func.value.attr
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        return func.value.id
    return ""


class PageVisitor(ast.NodeVisitor):
    """Collects the UI strings a page's __init__ builds."""

    def __init__(self):
        self.title = None
        self.subtitle = None
        self.tabs = []
        self.sections = []
        self.groups = []
        self.buttons = []
        self.labels = []
        self.placeholders = {}
        self.options = {}
        self.headers = []
        self.checkboxes = []
        self.widgets = {}
        # (label, widget-var) pairs -- the app binds them with addRow() and its
        # own _field() helper, and without the pairing a generated form has
        # placeholders with nothing above them.
        self.fields = []
        # Source lines, so each control can be bucketed into the tab it was
        # added to. The app builds a tab's widgets and *then* calls addTab, so
        # a control belongs to the first addTab after it.
        self.lines = {}
        self.tab_lines = []

    def visit_Assign(self, node):
        # `self.foo = QtWidgets.QLineEdit()` -> remember the widget kind.
        if isinstance(node.value, ast.Call):
            kind = call_name(node.value)
            if kind in INPUT_WIDGETS:
                for target in node.targets:
                    name = (target.attr if isinstance(target, ast.Attribute)
                            else target.id if isinstance(target, ast.Name) else None)
                    if name:
                        self.widgets[name] = kind
                        args = [literal(a) for a in node.value.args]
                        if kind == "QCheckBox" and args and args[0]:
                            self.checkboxes.append(args[0])
        self.generic_visit(node)

    def visit_Call(self, node):
        name = call_name(node)
        args = node.args

        if name == "PageHeader":
            strings = [literal(a) for a in args]
            if strings and strings[0]:
                self.title = strings[0]
            if len(strings) > 1 and strings[1]:
                self.subtitle = strings[1]

        elif name == "addTab" and len(args) >= 2:
            label = literal(args[1])
            if label:
                self.tabs.append(label)
                self.tab_lines.append((node.lineno, label))

        elif name == "CollapsibleSection" and args:
            label = literal(args[0])
            collapsed = any(
                kw.arg == "collapsed" and isinstance(kw.value, ast.Constant)
                and kw.value.value for kw in node.keywords)
            if label:
                self.sections.append({"title": label, "collapsed": bool(collapsed)})

        elif name == "QGroupBox" and args:
            label = literal(args[0])
            if label:
                self.groups.append(label)

        elif name == "QPushButton" and args:
            label = literal(args[0])
            if label:
                self.buttons.append(label)
                self.lines.setdefault("buttons", []).append((node.lineno, label))

        elif name == "QCheckBox" and args:
            label = literal(args[0])
            if label and label not in self.checkboxes:
                self.checkboxes.append(label)

        elif name == "QLabel" and args:
            label = literal(args[0])
            # Field captions and section titles; skip the placeholder dashes the
            # app uses for values it fills in later.
            if label and label not in {"-", "–", "—", ""} and len(label) < 90:
                self.labels.append(label)

        elif name == "setPlaceholderText" and args:
            text = literal(args[0])
            if text:
                self.placeholders[receiver(node)] = text

        elif name == "addItems" and args:
            items = literal_list(args[0])
            if items:
                self.options[receiver(node)] = items

        elif name in {"setHorizontalHeaderLabels", "setHeaderLabels"} and args:
            items = literal_list(args[0])
            if items:
                self.headers.append(items)

        elif name in {"addRow", "_field"} and len(args) >= 2:
            _pair_line = node.lineno
            label = literal(args[0])
            if label:
                self.labels.append(label)
                var = None
                target = args[1]
                if isinstance(target, ast.Attribute):
                    var = target.attr
                elif isinstance(target, ast.Name):
                    var = target.id
                if var:
                    self.fields.append([label, var])
                    self.lines.setdefault("fields", []).append((_pair_line, [label, var]))

        self.generic_visit(node)


def dedupe(seq):
    seen, out = set(), []
    for item in seq:
        key = (json.dumps(item, sort_keys=True)
               if isinstance(item, (dict, list)) else item)
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def extract():
    tree = ast.parse(QT_APP.read_text(encoding="utf-8"), filename=str(QT_APP))
    pages = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef) or node.name not in PAGE_CLASSES:
            continue
        visitor = PageVisitor()
        for item in node.body:
            visitor.visit(item)
        page_id = PAGE_CLASSES[node.name]
        tab_order = sorted(visitor.tab_lines)
        def bucket(kind):
            out = {label: [] for _, label in tab_order}
            loose = []
            for line, value in visitor.lines.get(kind, []):
                owner = next((label for at, label in tab_order if at >= line), None)
                (out[owner] if owner else loose).append(value)
            return out, loose
        button_tabs, button_loose = bucket("buttons")
        field_tabs, field_loose = bucket("fields")
        pages[page_id] = {
            "qt_class": node.name,
            "qt_line": node.lineno,
            "title": visitor.title,
            "subtitle": visitor.subtitle,
            "tabs": dedupe(visitor.tabs),
            "sections": dedupe(visitor.sections),
            "groups": dedupe(visitor.groups),
            "buttons": dedupe(visitor.buttons),
            "labels": dedupe(visitor.labels),
            "checkboxes": dedupe(visitor.checkboxes),
            "fields": dedupe(visitor.fields),
            "by_tab": {
                label: {
                    "buttons": dedupe(button_tabs.get(label, [])),
                    "fields": dedupe(field_tabs.get(label, [])),
                } for _, label in tab_order
            },
            "loose": {"buttons": dedupe(button_loose), "fields": dedupe(field_loose)},
            "placeholders": visitor.placeholders,
            "options": visitor.options,
            "tables": visitor.headers,
            "widgets": visitor.widgets,
        }
    return pages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", action="store_true")
    args = parser.parse_args()

    if not QT_APP.exists():
        raise SystemExit(f"Qt app not found at {QT_APP}")
    pages = extract()

    if args.summary:
        print(f"{len(pages)} page class(es) extracted from {QT_APP.name}\n")
        wide = max(len(k) for k in pages)
        print(f"{'page'.ljust(wide)}  tabs  sect  btns  fields  tables")
        for page_id, spec in sorted(pages.items()):
            print(f"{page_id.ljust(wide)}  "
                  f"{len(spec['tabs']):>4}  {len(spec['sections']):>4}  "
                  f"{len(spec['buttons']):>4}  {len(spec['placeholders']):>6}  "
                  f"{len(spec['tables']):>6}")
        missing = [p for p, s in pages.items() if not s["tabs"] and not s["sections"]]
        if missing:
            print(f"\nflat (no tabs or sections): {', '.join(sorted(missing))}")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(pages, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(Path.cwd()) if OUT.is_relative_to(Path.cwd()) else OUT}"
          f" — {len(pages)} pages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
