import type { Evidence, Preferences } from "./types";

interface KnowledgeTopic {
  keywords: string[];
  title: string;
  simple: string;
  everyday: string;
  advanced: string;
  points: string[];
  steps: string[];
}

const TOPICS: KnowledgeTopic[] = [
  {
    keywords: ["dictionary", "dict", "key value", "hash map", "hashmap", "python dictionary"],
    title: "Python Dictionary",
    simple: "In Python, a dictionary is like a real-world dictionary where you look up a word to find its meaning. It stores data as key-value pairs using curly braces. It is super fast because you don't have to search through a list—you just ask for the key and immediately get the value.",
    everyday: "In Python, a dictionary is a built-in mutable data structure that stores data in key-value pairs (`{key: value}`). Under the hood, it's implemented as an optimized hash table, giving you average O(1) constant time complexity for lookups, insertions, and deletions. Keys must be unique and immutable (like strings, numbers, or tuples), while values can be any data type.",
    advanced: "In Python, dictionaries (`dict`) are associative arrays implemented via a compact, insertion-ordered hash table (since Python 3.7+). Key lookups rely on the `__hash__` and `__eq__` protocols, providing O(1) amortized time complexity with open addressing collision resolution. Values are fully polymorphic, and modern Python dictionaries use an efficient two-array memory layout (sparse index array pointing into a dense entries table) to minimize memory overhead.",
    points: [
      "**Structure**: Stores associative data as `{key: value}` pairs, maintaining insertion order (Python 3.7+).",
      "**Performance**: Hash-table backed with O(1) amortized time complexity for get, set, and delete operations.",
      "**Key Invariant**: Keys must be immutable and hashable (e.g. strings, integers, tuples); values can be any object.",
      "**Safe Access**: Use `.get(key, default)` to avoid `KeyError`, and iterate efficiently via `.items()`, `.keys()`, and `.values()`."
    ],
    steps: [
      "1. **Core Concept**: An associative data structure mapping unique, hashable keys to arbitrary values.",
      "2. **Internal Mechanics**: Implemented using an open-addressed hash table with quadratic probing for collision resolution.",
      "3. **Practical Usage**: Ideal for caching, grouping data, counting frequencies with `collections.defaultdict` or `Counter`, and fast indexed lookups."
    ]
  },
  {
    keywords: ["dataset", "data set", "pandas", "dataframe", "numpy array", "python dataset"],
    title: "Datasets in Python",
    simple: "In Python, a dataset is a collection of information organized for analysis. Most of the time, people use tools like Pandas to load data from an Excel or CSV file into a table called a DataFrame, where you can easily filter, sort, and calculate numbers.",
    everyday: "In Python, a 'dataset' refers to structured data used for analysis, reporting, or machine learning. In data science, it is most commonly represented as a Pandas DataFrame or NumPy array loaded from CSV, JSON, or SQL databases. In machine learning frameworks like PyTorch or TensorFlow, a `Dataset` object handles lazy loading, data transformations, and batching for training models.",
    advanced: "In the Python ecosystem, datasets represent structured or semi-structured data pipelines. For analytical workflows, Pandas DataFrames provide in-memory tabular manipulation with vectorized NumPy C-extensions and columnar Apache Arrow backends. For distributed or big data scale, PySpark and Polars offer lazy execution graphs. In deep learning, `torch.utils.data.Dataset` abstracts iterative mini-batch extraction, shuffling, and multi-worker streaming pipelines.",
    points: [
      "**Analytical Representations**: Tabular data is typically loaded into a Pandas `DataFrame` or Polars table for fast vectorized transformations.",
      "**Numerical Computing**: NumPy `ndarray` represents contiguous n-dimensional arrays optimized for linear algebra and numerical operations.",
      "**Machine Learning Pipelines**: PyTorch (`Dataset`/`DataLoader`) and TensorFlow (`tf.data.Dataset`) provide streamed, batched, and GPU-sharded data loaders.",
      "**Core Python Equivalents**: Standard library representations include lists of dictionaries, namedtuples, or the `csv`/`sqlite3` modules."
    ],
    steps: [
      "1. **Definition**: A structured collection of records or tensors processed in analytical and machine learning workloads.",
      "2. **Ecosystem Libraries**: Handled by Pandas (in-memory dataframes), Polars (multithreaded/Arrow), and PyTorch/TF (streaming batches).",
      "3. **Standard Pipeline**: Ingest (CSV/Parquet/SQL) -> Clean & Validate -> Feature Engineering / Vectorization -> Model Training."
    ]
  },
  {
    keywords: ["linked list", "linkedlist", "singly linked list", "doubly linked list", "node next", "python linked list"],
    title: "Linked List in Python",
    simple: "A linked list is a chain of nodes where each node contains data and a pointer to the next node. Unlike a standard list where items sit next to each other in memory, linked list nodes can be anywhere in memory, connected like train cars.",
    everyday: "A linked list is a linear data structure where elements (nodes) contain data and a reference (pointer) to the next node. It allows O(1) insertions and deletions at the head, though searching requires O(N) linear traversal. In Python, you implement it using a `Node` class with `self.next` and a `LinkedList` class to track the head.",
    advanced: "A linked list is a non-contiguous sequential data structure. Singly linked lists maintain a head pointer with unidirectional node references, while doubly linked lists maintain both `prev` and `next` pointers. While Python dynamic arrays (`list`) offer contiguous cache locality and O(1) random indexing, linked lists provide O(1) splices and dequeues without buffer reallocation.",
    points: [
      "**Node Structure**: Each node contains a `data` attribute and a `next` pointer referencing the subsequent node.",
      "**Time Complexity**: O(1) insertion/deletion at head; O(N) lookup and arbitrary index access.",
      "**Memory Overhead**: Extra memory per node for pointer references; non-contiguous memory access reduces CPU cache locality.",
      "**Python Implementation**: Defined using a `Node(data)` class and a `LinkedList` wrapper managing `head`."
    ],
    steps: [
      "1. **Define Node**: Create a `Node` class with `self.data = data` and `self.next = None`.",
      "2. **Manage Head**: In `LinkedList`, initialize `self.head = None` and traverse using `curr = curr.next`.",
      "3. **Traversal & Edge Cases**: Always handle empty list (`head is None`) and single-node edge cases when traversing or deleting."
    ]
  },
  {
    keywords: ["list", "tuple", "list vs tuple", "python list", "python tuple"],
    title: "Lists vs Tuples in Python",
    simple: "In Python, a list is like a shopping list you can change, add items to, or erase (`[1, 2, 3]`). A tuple is like a birth certificate—once created with parentheses `(1, 2, 3)`, it is permanent and cannot be modified. Because tuples can't change, they are slightly faster and use less memory.",
    everyday: "In Python, both lists and tuples are ordered collections of items. The fundamental difference is that lists are mutable (`[1, 2, 3]`), meaning you can append, remove, or modify items in place. Tuples are immutable (`(1, 2, 3)`), meaning their contents cannot be changed once defined. Because of immutability, tuples can be used as dictionary keys and have lower memory overhead.",
    advanced: "Lists in Python are dynamic arrays that over-allocate memory buffers to achieve amortized O(1) append performance. Tuples are fixed-size immutable sequences allocated in a single contiguous memory block with zero resize overhead. Consequently, tuples support the hashable protocol (when containing only hashable elements), can serve as dictionary keys or set elements, and benefit from Python's internal tuple caching optimization.",
    points: [
      "**Mutability**: Lists are mutable (`list.append()`, `list.pop()`); tuples are immutable once instantiated.",
      "**Syntax**: Lists use square brackets `[]`; tuples use parentheses `()` or comma separation.",
      "**Memory & Performance**: Tuples have smaller memory footprints and faster instantiation than lists due to fixed allocation.",
      "**Dict Key Eligibility**: Tuples with immutable contents are hashable and valid dictionary keys; lists are unhashable."
    ],
    steps: [
      "1. **Mutability Difference**: Lists allow dynamic resizing and in-place item mutation; tuples remain strictly constant.",
      "2. **Memory Layout**: Lists maintain dynamic over-allocated pointer buffers; tuples allocate an exact contiguous slot array.",
      "3. **Practical Use Cases**: Use lists for dynamic collections of similar items; use tuples for heterogeneous records, coordinate pairs, or dict keys."
    ]
  },
  {
    keywords: ["gil", "global interpreter lock", "concurrency", "multithreading", "python threads"],
    title: "Global Interpreter Lock (GIL)",
    simple: "The GIL is a safety lock inside Python that allows only one thread to run Python code at a time. This keeps Python's memory safe and simple, but it means standard Python threads cannot use multiple CPU cores for heavy mathematical calculations. To use all CPU cores, you run multiple processes instead.",
    everyday: "The Global Interpreter Lock (GIL) is a mutex used by CPython to ensure that only one native thread executes Python bytecode at a time. It prevents race conditions in CPython's reference-counting memory management. While Python threads work great for I/O-bound tasks (like network calls and file reads), CPU-bound tasks require the `multiprocessing` module or native C extensions to achieve true multi-core parallelism.",
    advanced: "The GIL is a mutual exclusion lock protecting CPython internal state and reference counts from concurrent memory corruption. While threads release the GIL during blocking I/O (sockets, file descriptors, `time.sleep`) and inside optimized C/C++ extensions (NumPy, PyTorch), CPU-bound pure Python threads serialize execution on a single core. To bypass the GIL, architectures leverage `multiprocessing`, subinterpreters (PEP 684), or the upcoming free-threaded CPython (PEP 703).",
    points: [
      "**Purpose**: Protects CPython's reference counting memory management against concurrent race conditions.",
      "**I/O vs CPU Bound**: Excellent for concurrent I/O (network requests, DB queries); serializes CPU-intensive computations.",
      "**Overcoming the GIL**: Use `multiprocessing` (process pools), asynchronous concurrency (`asyncio`), or compiled C/Rust extensions.",
      "**Modern Evolution**: PEP 703 introduces optional free-threaded Python (no-GIL build) starting in Python 3.13+."
    ],
    steps: [
      "1. **Mechanism**: A process-level mutex ensuring single-threaded bytecode execution in CPython.",
      "2. **Impact**: Threads context-switch cooperatively or preemptively, but cannot execute concurrent bytecode on separate physical CPU cores.",
      "3. **Architectural Solutions**: Use `asyncio` for high-concurrency network I/O; use `multiprocessing.Pool` or Celery workers for CPU workloads."
    ]
  },
  {
    keywords: ["async", "asyncio", "await", "event loop", "asynchronous python"],
    title: "Async / Await and Event Loop in Python",
    simple: "Async and await let Python do other work while waiting for slow things, like downloading a webpage or querying a database. Instead of freezing the program, Python moves on to other tasks and comes back when the result is ready.",
    everyday: "In Python, `async` and `await` provide cooperative multitasking through an event loop via the `asyncio` module. When an `awaitable` function (coroutine) pauses for an I/O operation (like an HTTP request), it yields control back to the event loop, allowing other tasks to run concurrently on a single thread without the overhead of thread context-switching.",
    advanced: "Python's `asyncio` is a cooperative, single-threaded concurrency framework powered by an OS-level selector event loop (`epoll`, `kqueue`). Coroutines are generator-based state machines that pause execution at `await` expressions, yielding `Future` objects. By eliminating thread-stack allocation and lock contention, `asyncio` enables scaling to tens of thousands of concurrent I/O connections with minimal memory overhead.",
    points: [
      "**Event Loop**: Central scheduler that polls for ready I/O events and resumes suspended coroutines.",
      "**Coroutines**: Defined with `async def`; paused and resumed non-blockingly using `await`.",
      "**Cooperative Model**: Tasks voluntarily yield control; CPU-intensive blocking code must be delegated to thread or process executors.",
      "**Common Libraries**: `httpx`, `aiohttp`, `asyncpg`, and FastAPI for high-throughput non-blocking services."
    ],
    steps: [
      "1. **Core Concept**: Single-threaded concurrent I/O using cooperative task scheduling.",
      "2. **Event Loop Mechanism**: Monitors registered file descriptors and timers, executing tasks when ready.",
      "3. **Golden Rule**: Never run blocking synchronous operations (e.g. `time.sleep`, standard `requests.get`) inside async event loops."
    ]
  },
  {
    keywords: ["rest", "api", "rest api", "http methods", "status codes", "restful"],
    title: "RESTful API Architecture",
    simple: "A REST API is a standard way for applications to talk over the web using HTTP. You use standard methods like GET to retrieve information, POST to create something new, PUT to update, and DELETE to remove it, using standard status codes like 200 for OK and 404 for Not Found.",
    everyday: "A REST API (Representational State Transfer) is an architectural style for networked web services. It treats data entities as resources identified by clean URLs, and uses standard HTTP methods: `GET` to read, `POST` to create, `PUT`/`PATCH` to update, and `DELETE` to remove. Communication is stateless, meaning every request must contain all the information necessary to process it.",
    advanced: "REST is an architectural constraint model defined by Roy Fielding, encompassing stateless client-server separation, uniform resource identifiers (URIs), cacheable responses, layered system proxies, and self-descriptive messages. In production APIs, robust implementations ensure idempotency for `GET`, `PUT`, and `DELETE`, employ semantic HTTP status codes (2xx success, 4xx client fault, 5xx server fault), and utilize pagination, rate limiting, and content negotiation.",
    points: [
      "**HTTP Verbs**: `GET` (retrieve), `POST` (create), `PUT`/`PATCH` (replace/partial update), `DELETE` (remove).",
      "**Statelessness**: No client session state is retained on the server; each request is self-contained.",
      "**Semantic Status Codes**: 200/201 (success/created), 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found), 500 (server error).",
      "**Production Best Practices**: Consistent JSON schemas, versioning (`/v1/`), token-based authentication (OAuth2/Bearer), and rate limiting."
    ],
    steps: [
      "1. **Resource Modeling**: Expose plural nouns as endpoints (e.g. `/api/v1/users`, `/api/v1/orders`).",
      "2. **HTTP Semantics**: Match operations to appropriate verbs and adhere strictly to idempotency contracts.",
      "3. **Error Handling**: Return structured, human-readable error JSON payloads with accurate HTTP status codes."
    ]
  },
  {
    keywords: ["sql vs nosql", "relational", "database", "mongodb", "postgresql", "acid"],
    title: "SQL vs NoSQL Databases",
    simple: "SQL databases like PostgreSQL organize data into structured tables with strict columns and rows—great for banking or financial records where accuracy is critical. NoSQL databases like MongoDB store data as flexible JSON documents—great when data changes frequently or scales across many servers.",
    everyday: "SQL (relational) databases like PostgreSQL and MySQL organize data into structured tables with strict schemas and enforce ACID transactions, making them ideal for complex joins and data integrity. NoSQL databases (document, key-value, graph) like MongoDB, Redis, and Cassandra offer dynamic schemas and horizontal scaling, which works well for unstructured data, high write throughput, and rapidly evolving data models.",
    advanced: "SQL databases prioritize relational consistency, enforcing Codd's relational algebra and full ACID compliance via write-ahead logging (WAL) and multi-version concurrency control (MVCC). NoSQL systems trade strict immediate consistency for horizontal partitioning (sharding) and high availability, frequently adhering to the BASE model (Basically Available, Soft state, Eventual consistency) under Brewer's CAP theorem.",
    points: [
      "**Schema**: SQL has strict, predefined schemas with foreign keys; NoSQL offers dynamic, schema-less document/key-value storage.",
      "**Transactions**: SQL guarantees ACID compliance; NoSQL typically favors eventual consistency (BASE model).",
      "**Scaling**: SQL scales vertically (larger CPU/RAM/disks); NoSQL natively scales horizontally across distributed clusters.",
      "**Selection Heuristic**: Use SQL for relational integrity, transactions, and complex queries; use NoSQL for flexible schemas, high write velocity, or caching."
    ],
    steps: [
      "1. **Data Relationships**: Choose SQL when entities have complex many-to-many relationships requiring join integrity.",
      "2. **Access Patterns**: Choose NoSQL when queries access self-contained aggregate documents by primary key.",
      "3. **Consistency Requirements**: Choose SQL for strict financial/transactional consistency; NoSQL for distributed partition tolerance."
    ]
  },
  {
    keywords: ["index", "indexing", "database index", "b-tree", "sql performance"],
    title: "Database Indexing",
    simple: "A database index is like the index at the back of a textbook. Instead of scanning all 1,000 pages to find a topic, you look at the index to jump straight to the exact page. It makes searching and reading data very fast, but slightly slows down writing because the index must be updated.",
    everyday: "A database index is a data structure—most commonly a balanced B-Tree—that improves the speed of data retrieval on database tables at the cost of additional write time and storage space. Without an index, the database must perform a full table scan, checking every single row. With an index on a queried column, lookups drop from O(N) linear time to O(log N) logarithmic time.",
    advanced: "Relational database indexes organize column keys within multi-level B-Tree or B+Tree structures maintaining balanced tree depth and sorted page blocks. Queries with equality or range filters traverse root-to-leaf nodes in O(log N) I/O operations, retrieving row pointers (TIDs) or covering columns directly. While read operations accelerate dramatically, write operations (INSERT, UPDATE, DELETE) incur write amplification as index trees rebalance and page splits occur.",
    points: [
      "**Data Structure**: Typically B+Trees for range/equality scans, or Hash indexes for exact key lookups.",
      "**Query Optimization**: Reduces full table scans O(N) to O(log N) indexed lookups for `WHERE`, `JOIN`, and `ORDER BY` clauses.",
      "**Trade-off**: Extra disk storage and write latency on `INSERT`/`UPDATE` due to index maintenance.",
      "**Covering Indexes**: An index containing all columns requested by a `SELECT` avoids secondary heap table lookups entirely."
    ],
    steps: [
      "1. **Identify Query Bottlenecks**: Use `EXPLAIN ANALYZE` to identify sequential table scans on frequent queries.",
      "2. **Index High-Cardinality Columns**: Place indexes on columns with unique or high-diversity values used in filters and joins.",
      "3. **Composite Index Order**: Order multi-column indexes from left to right: equality columns first, followed by range columns."
    ]
  },
  {
    keywords: ["react", "virtual dom", "state vs props", "react hooks", "component lifecycle"],
    title: "React Architecture and Component State",
    simple: "React is a tool for building user interfaces by breaking the screen into small, reusable building blocks called components. When data changes, React updates only the specific part of the screen that changed, rather than reloading the entire web page.",
    everyday: "React is a component-based JavaScript library for building interactive user interfaces. It uses a virtual DOM—an in-memory lightweight representation of the actual DOM. When component state changes, React runs a reconciliation diffing algorithm to compute the minimal set of real DOM updates needed, ensuring high UI performance and responsive user experiences.",
    advanced: "React's declarative architecture utilizes a fiber reconciliation engine that models the component tree as a linked-list work graph. State updates trigger non-blocking concurrent rendering passes, performing heuristic O(N) reconciliation between virtual DOM snapshots. Changes are batched and flushed in a synchronous commit phase to the browser DOM, minimizing expensive layout reflows and repaints.",
    points: [
      "**Component Hierarchy**: Modular, reusable functions receiving immutable `props` and managing internal `state`.",
      "**Virtual DOM & Reconciliation**: Fiber architecture computes minimal real DOM mutations via heuristic diffing.",
      "**Modern Hooks**: `useState` for local state, `useEffect` for synchronized side-effects, `useMemo`/`useCallback` for referential caching.",
      "**Unidirectional Data Flow**: State flows down via props; events flow up via callbacks, creating predictable state transitions."
    ],
    steps: [
      "1. **Core Philosophy**: Declarative UI where the view is a pure function of state (`UI = f(state)`).",
      "2. **State Management**: Keep state localized; lift state up only when multiple sibling components require coordination.",
      "3. **Optimization**: Avoid premature optimization; use `React.memo` and dependency arrays to prevent unnecessary re-render cascades."
    ]
  },
  {
    keywords: ["git", "git rebase", "merge vs rebase", "git workflow"],
    title: "Git Workflow: Merge vs Rebase",
    simple: "Git helps you track changes in your code. Merging combines two branches by creating a new 'merge commit' that connects their histories. Rebasing takes your new commits and places them on top of the latest branch, creating a completely straight, clean history.",
    everyday: "In Git, merging and rebasing are two ways to integrate changes from one branch into another. `git merge` preserves complete chronological history by creating a two-parent merge commit. `git rebase` rewrites commit history by moving your feature commits onto the tip of the target branch, resulting in a clean, linear commit graph without merge clutter.",
    advanced: "Git branches are movable pointers referencing DAG (directed acyclic graph) commit objects. `git merge` performs a three-way merge between two branch tips and their common ancestor, generating a non-destructive merge commit. `git rebase` replays commits sequentially onto the base commit hash, producing new commit SHAs. Rule of thumb: rebase feature branches locally for linear review; never rebase shared public branches.",
    points: [
      "**Merge**: Non-destructive, retains authentic chronological history, introduces merge commits.",
      "**Rebase**: Creates a clean, linear history by replaying commits on top of the upstream branch; rewrites commit hashes.",
      "**Best Practice**: Rebase local feature branches before opening a PR; avoid rebasing shared main/master branches.",
      "**Conflict Resolution**: Merge resolves conflicts once; rebase pauses commit-by-commit to resolve conflicts during replay."
    ],
    steps: [
      "1. **Concept**: Integrating upstream changes into an active feature branch.",
      "2. **Execution**: `git fetch origin` followed by `git rebase origin/main` to keep local commits at the head.",
      "3. **Safety Golden Rule**: Never rewrite history or force-push on shared public collaboration branches."
    ]
  }
];

export function findMatchingTopic(question: string): KnowledgeTopic | null {
  const q = question.toLowerCase();
  let bestTopic: KnowledgeTopic | null = null;
  let maxScore = 0;

  for (const topic of TOPICS) {
    let score = 0;
    for (const kw of topic.keywords) {
      if (kw.includes(" ")) {
        if (q.includes(kw)) score += kw.split(" ").length * 5;
      } else {
        const regex = new RegExp(`\\b${kw}\\b`, "i");
        if (regex.test(q)) {
          // If the keyword is "list" and the query specifies "linked list", do not match generic list
          if (kw === "list" && q.includes("linked list")) continue;
          score += 2;
        }
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestTopic = topic;
    }
  }

  return maxScore > 0 ? bestTopic : null;
}

export function isCodeRequest(question: string): boolean {
  const q = question.toLowerCase();
  if (/(write|show|give|implement|create|generate|draft).{0,30}(code|function|method|program|script|implementation)/i.test(q)) return true;
  if (/^(code|python code|write code|show code|give me.*code)/i.test(q.trim())) return true;
  if (/write.*python/i.test(q) || /python.*(code|function|program|script)/i.test(q)) return true;
  if (/(implement|define).{0,30}(function|class|dict|dictionary|list)/i.test(q)) return true;
  return false;
}

function codeLanguage(question: string): string {
  const q = question.toLowerCase();
  if (/\bjavascript\b|\btypescript\b|\bjs\b/.test(q)) return "javascript";
  if (/\bsql\b/.test(q)) return "sql";
  if (/\bjava\b/.test(q)) return "java";
  return "python";
}

function codeExample(question: string, language: string): string {
  const q = question.toLowerCase();
  if (language === "python") {
    if (/linked ?list|node.*next/.test(q)) {
      return `class Node:\n    def __init__(self, data):\n        self.data = data\n        self.next = None\n\nclass LinkedList:\n    def __init__(self):\n        self.head = None\n\n    def append(self, data):\n        new_node = Node(data)\n        if not self.head:\n            self.head = new_node\n            return\n        curr = self.head\n        while curr.next:\n            curr = curr.next\n        curr.next = new_node\n\n    def display(self):\n        curr = self.head\n        while curr:\n            print(curr.data, end=" -> ")\n            curr = curr.next\n        print("None")\n\n# Usage:\nll = LinkedList()\nll.append(10)\nll.append(20)\nll.display()  # 10 -> 20 -> None`;
    }
    if (/implement.*(dict|dictionary|hash ?map)|how.*(dict|dictionary).*implemented/.test(q)) {
      return `class SimpleHashMap:\n    """Basic hash table implementation demonstrating open addressing / chaining."""\n    def __init__(self, size=16):\n        self.size = size\n        self.buckets = [[] for _ in range(size)]\n\n    def _hash(self, key):\n        return hash(key) % self.size\n\n    def set(self, key, value):\n        idx = self._hash(key)\n        for i, (k, v) in enumerate(self.buckets[idx]):\n            if k == key:\n                self.buckets[idx][i] = (key, value)\n                return\n        self.buckets[idx].append((key, value))\n\n    def get(self, key, default=None):\n        idx = self._hash(key)\n        for k, v in self.buckets[idx]:\n            if k == key:\n                return v\n        return default\n\n# Usage:\nd = SimpleHashMap()\nd.set("python", 3.12)\nprint(d.get("python"))  # 3.12`;
    }
    if (/dict|key.?value|hash ?map/.test(q)) {
      return `user_scores = {"ana": 92, "ben": 85}\nuser_scores["cara"] = 90\n\naverage = sum(user_scores.values()) / len(user_scores)\nprint(f"Average: {average:.1f}")\nprint(user_scores.get("dan", "not found"))`;
    }
    if (/list|tuple/.test(q)) {
      return `items = [3, 1, 2]\nitems.append(4)\ncoords = (10, 20)\n\nfor item in sorted(items):\n    print(item)\nprint(f"Point: {coords[0]}, {coords[1]}")`;
    }
    if (/dataset|dataframe|pandas|csv/.test(q)) {
      return `import pandas as pd\n\ndf = pd.read_csv("data.csv")\ndf = df.dropna()\nprint(df.head())\nprint(df.describe())`;
    }
    if (/async|await|event loop/.test(q)) {
      return `import asyncio\nimport httpx\n\nasync def fetch_titles(urls: list[str]) -> list[str]:\n    async with httpx.AsyncClient() as client:\n        results = []\n        for url in urls:\n            response = await client.get(url)\n            results.append(response.text[:100])\n        return results`;
    }
    if (/api|rest|http|flask|fastapi/.test(q)) {
      return `from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/users/{user_id}")\ndef get_user(user_id: int):\n    return {"user_id": user_id, "name": "Ana"}`;
    }
    // Generic fallback: exact runnable Python, no paragraph wrapper.
    return `def solve(items: list[int]) -> list[int]:\n    seen: dict[int, int] = {}\n    result: list[int] = []\n    for item in items:\n        if item not in seen:\n            seen[item] = 1\n            result.append(item)\n    return result\n\n\nif __name__ == "__main__":\n    print(solve([3, 1, 2, 1, 3]))`;
  }
  if (language === "sql") {
    return `SELECT department, AVG(salary) AS avg_salary\nFROM employees\nWHERE active = TRUE\nGROUP BY department\nORDER BY avg_salary DESC;`;
  }
  if (language === "javascript") {
    return `function unique(items) {\n  return [...new Set(items)];\n}\n\nconsole.log(unique([3, 1, 2, 1, 3]));`;
  }
  return `public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello");\n  }\n}`;
}

function stripPointers(text: string): string {
  // Natural voice must never contain bullet pointers, numbered steps, or bold markers.
  return text
    .replace(/^[\s•\-\*]+\s*/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/\*\*/g, "");
}

export function generateHumanAnswer(
  question: string,
  role: string,
  preferences: Preferences = {},
  evidence: Evidence[] = []
): { answer: string; keywords: string[] } {
  const rawDelivery = preferences.response_delivery || "natural";
  const level = preferences.english_level || "everyday";
  const length = ["concise", "balanced", "detailed"].includes(preferences.answer_style || "") ? preferences.answer_style! : "concise";
  const tone = preferences.answer_tone || "professional";
  // Code requests always win over delivery format: show exact code, not a paragraph.
  const codeIntent = isCodeRequest(question);
  const delivery = codeIntent ? "code" : rawDelivery;

  const topic = findMatchingTopic(question);
  const qWords = question.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3).slice(0, 5);

  // Exact code surface: fenced block first so the reader renders it as code.
  if (delivery === "code") {
    const language = codeLanguage(question);
    const snippet = codeExample(question, language);
    const vague = question.trim().split(/\s+/).length <= 4;
    const note = length === "concise"
      ? (vague ? "Here is a clean starting point. Tell me the exact task and I will tailor it." : "Here is how I would write it.")
      : (vague ? "Here is a clean starting point I use. Tell me the exact inputs and edge cases and I will tailor it." : "Here is how I would write it in my own work.");
    const plainNote = stripPointers(note);
    const answer = `\`\`\`${language}\n${snippet}\n\`\`\`\n${plainNote}`;
    return { answer, keywords: qWords };
  }

  // If we matched a technical topic
  if (topic) {
    const opener = tone === "casual"
      ? "Basically, "
      : tone === "friendly"
      ? "Great question! "
      : "";

    if (delivery === "talking_points") {
      const bullets = length === "concise" ? topic.points.slice(0, 3) : topic.points;
      const answer = `${opener}Here is the key breakdown of ${topic.title}:\n\n` + bullets.map(p => `• ${p}`).join("\n\n");
      return { answer, keywords: qWords };
    }

    if (delivery === "structured") {
      const steps = length === "concise" ? topic.steps.slice(0, 2) : topic.steps;
      const answer = `${opener}Here is how I explain ${topic.title} step-by-step:\n\n` + steps.join("\n\n");
      return { answer, keywords: qWords };
    }

    // Natural conversational delivery: first-person spoken voice, no pointers.
    // This must never contain • - * bullets, numbered steps, headers, or ** bold.
    let coreText = level === "simple" ? topic.simple : level === "advanced" ? topic.advanced : topic.everyday;
    if (length === "concise") {
      // Pick the first 2 concise sentences
      const sentences = coreText.split(/(?<=[.?!])\s+/);
      coreText = sentences.slice(0, 2).join(" ");
    } else if (length === "detailed") {
      coreText += " In my day-to-day work I use this to keep code clean and fast and to avoid runtime issues.";
    }
    // Voice: speak as "I" so the candidate can say it naturally.
    let voiceText = coreText
      .replace(/^In Python,\s*a dictionary is\b/i, "I use a Python dictionary when I need")
      .replace(/^In Python,\s*/i, "In my work I ")
      .replace(/^A (REST API|database index|database)/i, "I treat a $1");
    if (!/\bI\b/.test(voiceText.slice(0, 60))) {
      voiceText = (tone === "casual" ? "In my work, " : "In my work as a " + role + ", ") + voiceText.charAt(0).toLowerCase() + voiceText.slice(1);
    }

    const answer = stripPointers(`${opener}${voiceText}`);
    return { answer, keywords: qWords };
  }

  // If the question is about personal experience or not in static topics
  const hasEvidence = evidence.length > 0 && evidence[0]?.text;
  const primaryEvidence = hasEvidence ? evidence[0].text : `architecting scalable applications as a ${role}`;
  const sourceLabel = hasEvidence ? evidence[0].source_name : "my background";

  if (delivery === "talking_points") {
    const answer = `Here are the key points regarding this from my experience as a ${role}:

• **Core Approach**: I focus on understanding constraints early, designing modular systems, and ensuring reliable execution.
• **Practical Experience (${sourceLabel})**: ${primaryEvidence.slice(0, 160)}...
• **Outcome**: Consistently delivered high uptime, maintainable code, and scalable team delivery.`;
    return { answer, keywords: qWords };
  }

  if (delivery === "structured") {
    const answer = `Here is my structured approach to this:

1. **Analysis & Strategy**: Establish clear system requirements, identify edge cases, and choose the right tools for the job.
2. **Implementation (${sourceLabel})**: Applied in practice through ${primaryEvidence.slice(0, 150)}...
3. **Validation & Iteration**: Backed by automated testing, continuous integration, and performance benchmarking.`;
    return { answer, keywords: qWords };
  }

  // Natural answer
  const intro = tone === "casual"
    ? `In my experience as a ${role}, `
    : tone === "friendly"
    ? `From my background as a ${role}, `
    : `As a ${role}, `;

  const answer = length === "concise"
    ? `${intro}I focus on building reliable, clean solutions. In my recent work (${sourceLabel}), I applied this directly to ensure high performance and maintainable architecture.`
    : `${intro}I approach this by breaking down the problem into clear, testable components. In my work on ${sourceLabel}, I focused on ${primaryEvidence.slice(0, 140)}... This ensured high availability, clean separation of concerns, and smooth delivery across the engineering team.`;

  return { answer, keywords: qWords };
}
