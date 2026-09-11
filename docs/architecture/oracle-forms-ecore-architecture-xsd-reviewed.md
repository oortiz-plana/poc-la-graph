# Oracle Forms 6i Ecore Metamodel Architecture

## 1. Purpose

Define the EMF/Ecore architecture for Oracle Forms 6i using the XML produced by `frmf2xml`, based on the reviewed `oracleforms.xsd`, while reusing the existing Oracle PL/SQL Xtext/Ecore model.

The model must support:

- faithful ingestion of Oracle Forms XML;
- structural navigation across Forms objects;
- extraction and parsing of embedded PL/SQL;
- semantic references between Forms objects;
- dependency and impact analysis;
- future graph export and modernization analysis.

## 2. XSD Review Summary

The reviewed XSD has target namespace:

```text
http://xmlns.oracle.com/Forms
```

Relevant schema characteristics:

- `Module` is the XML envelope and contains exactly one of `FormModule`, `ObjectLibrary`, or `MenuModule`.
- The schema defines 43 global elements, 41 complex types, and 110 simple types.
- `FormModule` contains 18 kinds of child objects.
- `Block` contains `DataSourceArgument`, `DataSourceColumn`, `Item`, `Relation`, and `Trigger`.
- `Item` contains `RadioButton`, `Trigger`, and `ListItemElement`.
- `Canvas` contains `Graphics`, `TabPage`, and `VisualState`.
- `Event` and `PropertyClass` can contain `Trigger` objects.
- `LOV` contains `LOVColumnMapping`.
- `RecordGroup` contains `RecordGroupColumn`, which contains `RecordGroupColumnRow`.
- `Graphics` is recursive and may contain `CompoundText`, nested `Graphics`, and `Point`.
- `PropertyClass` uses the XSD `JdapiProperties` attribute group, which exposes approximately 500 possible Forms properties.
- Several XSD enum types accept both textual and numeric values, for example `Table` and `1` for `QueryDataSourceType`.

These findings require changes to the previous metamodel proposal.

## 3. Changes from the Previous Definition

| Previous definition | Revised decision |
|---|---|
| Hand-written StAX importer as primary XML parser | Generate a raw EMF model from the XSD and deserialize XML through EMF; keep a mapper into the semantic model |
| `Relation` directly contained by `FormModule` | `Relation` is contained by `Block` |
| `Window` contains `Canvas` | No containment. The XSD links them through names such as `Canvas.WindowName` and `Window.PrimaryCanvas` |
| Limited `FormModule` children | Add XSD-defined objects such as `Coordinate`, `AttachedLibrary`, `Editor`, `Event`, `Menu`, `ObjectGroup`, and `Report` |
| Canvas represented mainly as a display container | Add contained `Graphics`, `TabPage`, and `VisualState` |
| Item contained only triggers | Add `RadioButton` and `ListItemElement` |
| Property bag considered optional convenience | Keep full raw XSD properties in the generated XML model; promote only semantically relevant properties to the canonical Forms model |
| XSD mapped directly to canonical Forms model | Use separate raw and semantic Ecore models |

## 4. Recommended Architecture

Use two EMF models.

1. **Raw XML model** generated from `oracleforms.xsd`.
2. **Canonical semantic Forms model** designed for analysis, Xtext integration, navigation, and graph generation.

```mermaid
flowchart LR
    FMB["Oracle Forms 6i<br/>.fmb"] --> F2X["frmf2xml"]
    F2X --> XML["Oracle Forms XML"]

    XSD["oracleforms.xsd"] --> GEN["EMF XSD Import<br/>Generate Ecore + GenModel"]
    GEN --> RAW["oracle.forms.xml.ecore<br/>Generated Raw Model"]

    XML --> LOAD["EMF XML Resource"]
    RAW --> LOAD

    LOAD --> MAP["FormsSemanticMapper"]
    MAP --> SEM["oracle.forms.model.ecore<br/>Canonical Semantic Model"]

    SEM --> CODE["Embedded Code Extractor"]
    CODE --> PLSQL["Existing PL/SQL Xtext Parser"]
    PLSQL --> PAST["PL/SQL EMF AST"]

    SEM --> LINK["Forms Semantic Linker"]
    PAST --> LINK

    LINK --> ANALYSIS["Analysis Model"]
    ANALYSIS --> UI["Eclipse Navigation"]
    ANALYSIS --> GRAPH["Neo4j / Impact Analysis"]
```

### Rationale

The generated raw model guarantees schema fidelity and avoids manually maintaining mappings for hundreds of XML attributes. The canonical model remains stable, smaller, and focused on behavior and dependencies.

Do not use the XSD-generated Ecore directly as the domain model because it preserves XML serialization concerns, string-based references, schema-specific naming, and large generic property sets that are not ideal for semantic analysis.

## 5. XSD Structural Model

The XML envelope is:

```mermaid
classDiagram
    class Module {
        +version : long
    }

    class FormModule
    class MenuModule
    class ObjectLibrary

    Module --> "1" FormModule : choice
    Module --> "1" MenuModule : choice
    Module --> "1" ObjectLibrary : choice
```

For the initial `.fmb` scope, `FormModule` is the canonical root after import. `Module` can remain part of the raw XSD model only.

## 6. FormModule Containment

The XSD defines the following direct children of `FormModule`:

```mermaid
classDiagram
    class FormModule
    class Coordinate
    class Alert
    class AttachedLibrary
    class Block
    class Canvas
    class Editor
    class Event
    class ModuleParameter
    class LOV
    class Menu
    class ObjectGroup
    class ProgramUnit
    class PropertyClass
    class RecordGroup
    class Report
    class Trigger
    class VisualAttribute
    class Window

    FormModule *-- "0..*" Coordinate
    FormModule *-- "0..*" Alert
    FormModule *-- "0..*" AttachedLibrary
    FormModule *-- "0..*" Block
    FormModule *-- "0..*" Canvas
    FormModule *-- "0..*" Editor
    FormModule *-- "0..*" Event
    FormModule *-- "0..*" ModuleParameter
    FormModule *-- "0..*" LOV
    FormModule *-- "0..*" Menu
    FormModule *-- "0..*" ObjectGroup
    FormModule *-- "0..*" ProgramUnit
    FormModule *-- "0..*" PropertyClass
    FormModule *-- "0..*" RecordGroup
    FormModule *-- "0..*" Report
    FormModule *-- "0..*" Trigger
    FormModule *-- "0..*" VisualAttribute
    FormModule *-- "0..*" Window
```

The semantic model should retain this containment where it represents real Forms ownership.

## 7. Core Canonical Ecore Hierarchy

The XSD itself does not define a shared superclass for Forms objects. The canonical Ecore should introduce one for identity, navigation, and source traceability.

```mermaid
classDiagram
    class FormObject {
        <<abstract>>
        +name : EString
        +qualifiedName : EString
        +comment : EString
    }

    class SourceLocation {
        +sourceXml : EString
        +xmlPath : EString
        +startLine : EInt
        +endLine : EInt
    }

    class FormProperty {
        +name : EString
        +value : EString
    }

    class Block
    class Item
    class Trigger
    class ProgramUnit
    class Canvas
    class Window
    class LOV
    class RecordGroup
    class Relation
    class Alert
    class Editor
    class Event
    class Report
    class VisualAttribute
    class PropertyClass
    class ObjectGroup

    FormObject --> "0..1" SourceLocation : source
    FormObject *-- "0..*" FormProperty : properties

    FormObject <|-- Block
    FormObject <|-- Item
    FormObject <|-- Trigger
    FormObject <|-- ProgramUnit
    FormObject <|-- Canvas
    FormObject <|-- Window
    FormObject <|-- LOV
    FormObject <|-- RecordGroup
    FormObject <|-- Relation
    FormObject <|-- Alert
    FormObject <|-- Editor
    FormObject <|-- Event
    FormObject <|-- Report
    FormObject <|-- VisualAttribute
    FormObject <|-- PropertyClass
    FormObject <|-- ObjectGroup
```

`FormProperty` is not intended to replace typed semantic attributes. It is used only when a property is useful to retain but does not justify a dedicated EAttribute in the canonical model. The raw generated model remains the authoritative complete representation of XSD properties.

## 8. Block Model

The XSD defines the following containment:

```mermaid
classDiagram
    class Block {
        +databaseBlock : EBoolean
        +queryDataSourceType : QueryDataSourceType
        +queryDataSourceName : EString
        +dmlDataName : EString
        +whereClause : EString
        +orderByClause : EString
        +insertAllowed : EBoolean
        +updateAllowed : EBoolean
        +deleteAllowed : EBoolean
        +queryAllowed : EBoolean
    }

    class DataSourceArgument
    class DataSourceColumn
    class Item
    class Relation
    class Trigger

    Block *-- "0..*" DataSourceArgument : dataSourceArguments
    Block *-- "0..*" DataSourceColumn : dataSourceColumns
    Block *-- "0..*" Item : items
    Block *-- "0..*" Relation : relations
    Block *-- "0..*" Trigger : triggers
```

The XSD `QueryDataSourceType` values include:

```text
None
Table
Procedure
Transactional Triggers
FROM clause query
```

The semantic model must therefore not assume that every database block maps directly to a table.

### Recommended semantic references

```mermaid
flowchart LR
    B["Block"] -->|nextNavigationBlock| BN["Block"]
    B -->|previousNavigationBlock| BP["Block"]
    B -->|queryDataSource| DB["Database Object / Query Model"]
    B -->|dmlTarget| DML["Database Object"]
```

Database targets should be resolved in the analysis layer, not by coupling `OracleForms.ecore` directly to the PL/SQL/database model.

## 9. Item Model

The XSD defines:

```mermaid
classDiagram
    class Item {
        +itemType : ItemType
        +databaseItem : EBoolean
        +columnName : EString
        +dataType : EString
        +required : EBoolean
        +visible : EBoolean
        +enabled : EBoolean
    }

    class RadioButton
    class Trigger
    class ListItemElement {
        +index : EInt
        +name : EString
        +value : EString
    }

    Item *-- "0..*" RadioButton : radioButtons
    Item *-- "0..*" Trigger : triggers
    Item *-- "0..*" ListItemElement : listElements
```

The XSD `ItemType` includes at least:

```text
Bean Area
Check Box
Display Item
Hierarchical Tree
Image
List Item
Push Button
Radio Group
Text Item
User Area
ActiveX Control
Chart Item
OLE Container
Sound
VBX Control
```

The semantic model should normalize both textual and numeric XSD aliases into one EEnum literal.

### Important Item references to resolve

The XSD represents these as strings; the semantic model should convert them into EReferences when the target exists:

```text
CanvasName                    -> Canvas
TabPageName                   -> TabPage
LovName                       -> LOV
RecordGroupName               -> RecordGroup
NextNavigationItemName        -> Item
PreviousNavigationItemName    -> Item
SynchronizedItemName          -> Item
SummaryBlockName              -> Block
SummaryItemName               -> Item
VisualAttributeName           -> VisualAttribute
```

## 10. Relation Model

The XSD places `Relation` inside `Block`.

The containing block is therefore the natural master block.

```mermaid
classDiagram
    class Block

    class Relation {
        +joinCondition : EString
        +relationType : RelationType
        +deleteRecord : DeleteRecordType
        +deferred : EBoolean
        +autoQuery : EBoolean
        +preventMasterlessOperations : EBoolean
    }

    Block *-- "0..*" Relation : relations
    Relation --> "1" Block : masterBlock
    Relation --> "0..1" Block : detailBlock
    Relation --> "0..1" Item : detailItem
```

`masterBlock` is derived from containment; `detailBlock` is resolved from the XSD `DetailBlock` string.

XSD values include:

```text
RelationType: Join | Ref
DeleteRecord: Cascading | Isolated | Non Isolated
```

## 11. Canvas and Presentation Model

The previous model incorrectly implied that `Window` owns canvases. The XSD shows that both are direct children of `FormModule` and reference each other by name.

```mermaid
classDiagram
    class FormModule
    class Window
    class Canvas {
        +canvasType : CanvasType
        +windowName : EString
    }
    class Graphics
    class TabPage
    class VisualState

    FormModule *-- "0..*" Window
    FormModule *-- "0..*" Canvas

    Canvas *-- "0..*" Graphics
    Canvas *-- "0..*" TabPage
    Canvas *-- "0..*" VisualState

    Canvas --> "0..1" Window : window
    Window --> "0..1" Canvas : primaryCanvas
    Window --> "0..1" Canvas : horizontalToolbarCanvas
    Window --> "0..1" Canvas : verticalToolbarCanvas
```

XSD `CanvasType` values include:

```text
Content
Stacked
Vertical Toolbar
Horizontal Toolbar
Tab
```

### Tab pages and graphics

```mermaid
classDiagram
    class Canvas
    class TabPage
    class Graphics
    class CompoundText
    class TextSegment
    class Point

    Canvas *-- "0..*" TabPage
    Canvas *-- "0..*" Graphics
    TabPage *-- "0..*" Graphics

    Graphics *-- "0..*" Graphics : children
    Graphics *-- "0..*" CompoundText
    Graphics *-- "0..*" Point
    CompoundText *-- "0..*" TextSegment
```

For the first dependency-analysis POC, detailed graphics can be imported but excluded from graph generation unless presentation analysis is required.

## 12. LOV and RecordGroup

```mermaid
classDiagram
    class LOV {
        +recordGroupName : EString
        +title : EString
        +autoRefresh : EBoolean
    }

    class LOVColumnMapping {
        +name : EString
        +returnItem : EString
        +title : EString
        +displayWidth : EInt
    }

    class RecordGroup {
        +recordGroupType : RecordGroupType
        +recordGroupQuery : EString
    }

    class RecordGroupColumn
    class RecordGroupColumnRow

    LOV *-- "0..*" LOVColumnMapping
    LOV --> "0..1" RecordGroup : recordGroup

    RecordGroup *-- "0..*" RecordGroupColumn
    RecordGroupColumn *-- "0..*" RecordGroupColumnRow

    LOVColumnMapping --> "0..1" Item : returnItem
```

`RecordGroupQuery` is SQL text and should be analyzed separately from PL/SQL code.

## 13. Event and PropertyClass Triggers

The XSD shows that triggers can exist under more containers than originally modeled.

```mermaid
classDiagram
    class Trigger
    class FormModule
    class Block
    class Item
    class Event
    class PropertyClass

    FormModule *-- "0..*" Trigger
    Block *-- "0..*" Trigger
    Item *-- "0..*" Trigger
    Event *-- "0..*" Trigger
    PropertyClass *-- "0..*" Trigger
```

Do not encode trigger ownership using separate trigger classes. A single `Trigger` EClass plus EObject containment is sufficient.

## 14. Embedded PL/SQL Integration

The XSD exposes source code primarily through:

```text
Trigger.TriggerText
ProgramUnit.ProgramUnitText
```

Additional code or query-bearing attributes include:

```text
RecordGroup.RecordGroupQuery
Item.TreeDataQuery
MenuItem.MenuItemCode
MenuItem.CommandText
MenuModule.StartupCode
```

For the `.fmb` POC, prioritize `TriggerText` and `ProgramUnitText`.

```mermaid
flowchart LR
    T["Trigger"] -->|TriggerText| CE["Code Extractor"]
    PU["ProgramUnit"] -->|ProgramUnitText| CE

    CE --> XR["XtextResource"]
    XR --> XP["Existing Oracle PL/SQL Xtext Parser"]
    XP --> AST["PL/SQL EMF AST"]

    T --> BIND["FormsCodeBinding"]
    PU --> BIND
    AST --> BIND
```

Recommended integration model:

```mermaid
classDiagram
    class FormsCodeBinding {
        +resourceUri : EString
        +parseStatus : ParseStatus
    }

    class FormObject
    class Trigger
    class ProgramUnit
    class PlsqlCompilationUnit {
        <<existing PL/SQL Ecore>>
    }

    FormObject <|-- Trigger
    FormObject <|-- ProgramUnit

    FormsCodeBinding --> "1" FormObject : owner
    FormsCodeBinding --> "0..1" PlsqlCompilationUnit : astRoot
```

Do not embed the complete PL/SQL AST inside `OracleForms.ecore`.

## 15. Forms-specific PL/SQL Semantics

The existing PL/SQL parser should continue to own the AST. A Forms semantic layer should resolve constructs such as:

```text
:BLOCK.ITEM
:PARAMETER.NAME
:GLOBAL.NAME
:SYSTEM.NAME
```

and classify Forms built-ins such as:

```text
GO_BLOCK
GO_ITEM
EXECUTE_QUERY
COMMIT_FORM
CLEAR_FORM
DO_KEY
SET_ITEM_PROPERTY
SET_BLOCK_PROPERTY
SHOW_ALERT
```

```mermaid
flowchart LR
    AST["PL/SQL AST"] --> FS["Forms PL/SQL Semantic Analyzer"]

    FS --> IR["READS_FORM_ITEM"]
    FS --> IW["WRITES_FORM_ITEM"]
    FS --> NAV["NAVIGATES_TO"]
    FS --> CALL["CALLS_FORM_UNIT"]
    FS --> TX["TRANSACTION_OPERATION"]

    IR --> ITEM["Item"]
    IW --> ITEM
    NAV --> TARGET["Block / Item / Form"]
```

These are derived semantic relationships and belong in the analysis model, not in the source Ecore containment tree.

## 16. String References That Should Become EReferences

The XSD uses many name-based attributes. The semantic mapper/linker should resolve high-value references.

| XSD source | XSD attribute | Semantic target |
|---|---|---|
| `FormModule` | `FirstNavigationBlockName` | `Block` |
| `FormModule` | `HorizontalToolbarCanvas` | `Canvas` |
| `FormModule` | `VerticalToolbarCanvas` | `Canvas` |
| `Block` | `NextNavigationBlockName` | `Block` |
| `Block` | `PreviousNavigationBlockName` | `Block` |
| `Relation` | `DetailBlock` | `Block` |
| `Item` | `CanvasName` | `Canvas` |
| `Item` | `TabPageName` | `TabPage` |
| `Item` | `LovName` | `LOV` |
| `Item` | `RecordGroupName` | `RecordGroup` |
| `Item` | `NextNavigationItemName` | `Item` |
| `Item` | `PreviousNavigationItemName` | `Item` |
| `LOV` | `RecordGroupName` | `RecordGroup` |
| `LOVColumnMapping` | `ReturnItem` | `Item` |
| `Canvas` | `WindowName` | `Window` |
| `Window` | `PrimaryCanvas` | `Canvas` |
| `Window` | `HorizontalToolbarCanvasName` | `Canvas` |
| `Window` | `VerticalToolbarCanvasName` | `Canvas` |
| `Graphics` | `LayoutDataBlockName` | `Block` |
| `Graphics` | `TabPageName` | `TabPage` |
| `Report` | `DataSourceBlock` | `Block` |

Unresolved values should be retained as their original string plus a diagnostic; the importer should never discard them.

## 17. Property Strategy

The XSD is property-heavy. `Item` alone exposes more than 160 attributes, and `PropertyClass` references the large `JdapiProperties` attribute group.

A one-to-one hand-written semantic attribute model would be unnecessarily large.

Use three categories:

### Category A — typed semantic attributes

Promote properties that affect behavior or dependencies, for example:

```text
DatabaseBlock
QueryDataSourceType
QueryDataSourceName
DMLDataName
WhereClause
OrderByClause
ColumnName
DatabaseItem
ItemType
DataType
CanvasName
LovName
TriggerText
ProgramUnitText
RecordGroupQuery
JoinCondition
DetailBlock
```

### Category B — semantic references

Convert name properties into EReferences where possible.

### Category C — remaining raw properties

Keep them in the generated XSD model and optionally mirror required values into `FormProperty`.

```mermaid
flowchart LR
    RAW["Raw XSD EObject"] --> TYPED["Typed Semantic Attributes"]
    RAW --> REF["Resolved EReferences"]
    RAW --> BAG["Optional FormProperty"]

    TYPED --> FORM["Canonical FormObject"]
    REF --> FORM
    BAG --> FORM
```

## 18. Enum Normalization

The XSD often allows both a textual value and a numeric representation for the same semantic value.

Examples:

```text
QueryDataSourceType:
  Table | 1
  Procedure | 2

ProgramUnitType:
  Procedure | 1
  Function | 2

CanvasType:
  Content | 0
  Stacked | 1
```

The raw model should preserve the XML value. The semantic mapper should normalize both forms to one EEnum literal.

```mermaid
flowchart LR
    XML1["Table"] --> N["Enum Normalizer"]
    XML2["1"] --> N
    N --> ENUM["QueryDataSourceType.TABLE"]
```

## 19. Package Architecture

```mermaid
flowchart TD
    XSDP["oracle.forms.xml<br/>Generated from XSD"]
    MODEL["oracle.forms.model<br/>Canonical OracleForms.ecore"]
    IMPORT["oracle.forms.importer<br/>Raw -> Semantic Mapper"]
    LINK["oracle.forms.linker<br/>Name/reference resolution"]
    CODE["oracle.forms.plsql<br/>Code extraction + Forms semantics"]
    ANALYSIS["oracle.forms.analysis<br/>Derived dependencies"]
    UI["oracle.forms.ui<br/>Eclipse explorer/navigation"]
    GRAPH["oracle.forms.graph<br/>Neo4j export"]

    PLSQL["Existing oracle.plsql.xtext"]

    XSDP --> IMPORT
    IMPORT --> MODEL
    MODEL --> LINK
    MODEL --> CODE
    PLSQL --> CODE
    LINK --> ANALYSIS
    CODE --> ANALYSIS
    ANALYSIS --> UI
    ANALYSIS --> GRAPH
```

Suggested Eclipse projects:

```text
oracle.forms.xml
oracle.forms.model
oracle.forms.importer
oracle.forms.linker
oracle.forms.plsql
oracle.forms.analysis
oracle.forms.ui
oracle.forms.graph
```

## 20. Canonical Model Scope for the First POC

Implement first:

```text
FormModule
Coordinate
Block
DataSourceArgument
DataSourceColumn
Item
RadioButton
ListItemElement
Trigger
ProgramUnit
Relation
Canvas
TabPage
Window
LOV
LOVColumnMapping
RecordGroup
RecordGroupColumn
Alert
AttachedLibrary
ModuleParameter
VisualAttribute
```

Load but postpone semantic analysis for:

```text
Graphics
CompoundText
Point
VisualState
Editor
Event
Menu
ObjectGroup
PropertyClass
Report
```

The raw XSD model still preserves all of these, so postponing semantic mapping does not lose source information.

## 21. Target Unified Semantic Model

```mermaid
flowchart LR
    FORM["FormModule"] -->|CONTAINS| BLOCK["Block"]
    BLOCK -->|CONTAINS| ITEM["Item"]
    ITEM -->|HAS_TRIGGER| TRIGGER["Trigger"]

    ITEM -->|DISPLAYED_ON| CANVAS["Canvas"]
    CANVAS -->|WINDOW| WINDOW["Window"]
    ITEM -->|USES| LOV["LOV"]
    LOV -->|USES| RG["RecordGroup"]

    BLOCK -->|HAS_RELATION| REL["Relation"]
    REL -->|DETAIL_BLOCK| DETAIL["Block"]

    TRIGGER -->|CODE| AST["PL/SQL AST"]
    AST -->|CALLS| PROC["PL/SQL Routine"]
    AST -->|READS / WRITES| TABLE["Database Table"]

    BLOCK -->|DATA_SOURCE| TABLE
    ITEM -->|BOUND_TO| COLUMN["Database Column"]
```

This is the model required for questions such as:

```text
Which Forms trigger invokes this package routine?
Which form items depend on this table column?
What happens if this package procedure changes?
Which Forms navigation paths reach this block?
Which Forms business flow writes to this table?
```

## 22. Architectural Decisions

| ADR | Decision |
|---|---|
| ADR-001 | Treat `frmf2xml` XML as an interchange/source format, not the canonical semantic model |
| ADR-002 | Generate a raw EMF model from `oracleforms.xsd` |
| ADR-003 | Maintain a separate curated `OracleForms.ecore` semantic model |
| ADR-004 | Map raw XSD EObjects to semantic EObjects using a dedicated mapper |
| ADR-005 | Preserve XSD containment where it represents actual Forms ownership |
| ADR-006 | Resolve name-based XSD attributes into semantic EReferences |
| ADR-007 | Keep unresolved original names and diagnostics |
| ADR-008 | Normalize textual/numeric XSD enum aliases in the semantic model |
| ADR-009 | Reuse the existing PL/SQL Xtext/Ecore model for `TriggerText` and `ProgramUnitText` |
| ADR-010 | Keep Forms-specific references and built-ins in a semantic-analysis layer |
| ADR-011 | Do not embed PL/SQL ASTs directly into `OracleForms.ecore` |
| ADR-012 | Keep UI containment (`Canvas`, `TabPage`, `Graphics`) separate from block/data containment |
| ADR-013 | Model `Relation` under its containing/master `Block` |
| ADR-014 | Link `Window` and `Canvas` through semantic references, not containment |
| ADR-015 | Keep complete property fidelity in the raw XSD model and only promote useful properties into the semantic model |

## 23. Recommended Processing Flow

```mermaid
sequenceDiagram
    participant CLI as frmf2xml
    participant XML as Forms XML
    participant EMF as Raw EMF Resource
    participant MAP as Semantic Mapper
    participant LINK as Forms Linker
    participant XTEXT as PL/SQL Xtext
    participant ANA as Analyzer

    CLI->>XML: Generate XML
    XML->>EMF: Deserialize using XSD-generated model
    EMF->>MAP: Raw EObjects
    MAP->>MAP: Normalize enums and properties
    MAP->>LINK: Canonical Forms model
    LINK->>LINK: Resolve Forms references
    LINK->>XTEXT: Extract TriggerText / ProgramUnitText
    XTEXT-->>ANA: PL/SQL AST
    LINK-->>ANA: Forms semantic model
    ANA->>ANA: Build dependencies and impact relationships
```

## 24. Final Recommendation

Use the XSD as the **serialization contract** and generate an EMF raw model from it, but do not make that generated Ecore the long-term domain model.

The canonical `OracleForms.ecore` should represent the concepts needed for analysis and modernization, while the generated XSD model provides complete source fidelity. This architecture gives a clean separation between:

```text
Oracle XML representation
        ↓
Raw XSD-backed EMF model
        ↓
Canonical Forms semantic model
        ↓
Existing PL/SQL Xtext model
        ↓
Cross-language dependency analysis
```

This also minimizes custom XML parsing code, prevents the canonical model from becoming a 500-property mirror of JDAPI, and provides a stable foundation for Eclipse navigation, impact analysis, Neo4j export, and future Oracle Forms migration tooling.
