import type { Evidence, Preferences } from "./types";
import { findCompany } from "./companies";

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
    keywords: ["palindrome", "check palindrome", "palindrome string", "palindrome python", "valid palindrome"],
    title: "Palindrome in Python",
    simple: "A palindrome is a word that reads the same forwards and backwards, like 'racecar'. In Python, the simplest way to check this is to clean the string to lowercase letters and numbers, then compare it with its reverse slice using clean == clean[::-1]. It runs in O(N) time and is very clean and easy to explain in an interview.",
    everyday: "A palindrome reads identically forwards and backwards. In Python, the most efficient and readable solution normalizes the string to lowercase alphanumeric characters (''.join(c.lower() for c in s if c.isalnum())) and compares it to its reverse using slice notation (clean == clean[::-1]). This takes O(N) linear time and is simple and bug-free. If the interviewer asks for O(1) space, you can also describe a two-pointer approach comparing characters from both ends.",
    advanced: "Palindrome validation verifies character symmetry around a center axis. The idiomatic Python solution normalizes the string to alphanumeric characters and performs a slice comparison clean == clean[::-1], taking O(N) time with vectorized C-level performance in CPython. For strict in-place constraints with O(1) auxiliary memory, a two-pointer technique increments a left index and decrements a right index while skipping non-alphanumeric characters, terminating when pointers cross.",
    points: [
      "**String Normalization**: Filter out non-alphanumeric characters and lowercase using `''.join(c.lower() for c in s if c.isalnum())`.",
      "**Idiomatic Reverse Comparison**: Compare with reverse slice `clean == clean[::-1]` for clean, readable O(N) validation.",
      "**Time & Space Complexity**: Runs in O(N) time with O(N) space for the cleaned string; simple and bug-free to present.",
      "**Two-Pointer Alternative**: Mention left/right pointer comparison from both ends if O(1) auxiliary space is requested."
    ],
    steps: [
      "1. **Normalize Input**: Strip punctuation and whitespace, converting all letters to lowercase so comparisons are case-insensitive.",
      "2. **Compare with Reverse**: Return `clean == clean[::-1]`, which takes advantage of Python's highly optimized internal string comparison.",
      "3. **Explain Tradeoffs**: Explain O(N) time complexity to the interviewer, noting two-pointer traversal as an in-place alternative."
    ]
  },
  {
    keywords: ["sequential data type", "sequence type", "sequence types", "sequence data types", "sequential data types in python", "python sequences", "sequential types", "sequence in python"],
    title: "Sequence Types in Python",
    simple: "In Python, sequence types are ordered collections where items can be accessed by an index number starting from 0. The core built-in ones are lists (mutable collections), tuples (immutable collections), strings (text characters), and ranges (used for loops). They all support indexing, slicing, and checking length with len().",
    everyday: "In Python, sequence types represent ordered collections of items that support index-based access and slicing. The core built-in sequence types are `list` (mutable dynamic array), `tuple` (immutable sequence), `str` (immutable Unicode text), and `range` (memory-efficient integer arithmetic sequence). All sequences share standard operations: `len()`, indexing (`s[i]`), negative indexing (`s[-1]`), slicing (`s[start:stop:step]`), concatenation (`+`), and membership testing (`in`).",
    advanced: "In Python, sequence types conform to the `Sequence` and `Reversible` abstract base classes in `collections.abc`, implementing `__getitem__` and `__len__`. They are categorized as mutable (`list`, `bytearray`) or immutable (`tuple`, `str`, `bytes`, `range`). Slicing utilizes slice objects (`slice(start, stop, step)`) executing in C-level pointer manipulation. Sequences provide contiguous cache locality, O(1) random access by index, and O(N) linear scans for membership, in contrast to associative mappings (dictionaries/sets) that rely on hash tables.",
    points: [
      "**Core Types**: Built-in sequence types include `list` (mutable), `tuple` (immutable), `str` (character sequence), and `range` (arithmetic sequence).",
      "**Common Operations**: All sequences support indexing (`s[0]`), negative indexing (`s[-1]`), slicing (`s[1:4]`), `len()`, and iteration.",
      "**Mutability Distinction**: Lists allow in-place item assignment and appending; tuples, strings, and ranges are immutable.",
      "**Performance**: Indexing is O(1) constant time; searching/membership with `in` is O(N) linear time."
    ],
    steps: [
      "1. **Definition**: An ordered collection supporting index-based access starting at 0 and slicing via `s[start:stop:step]`.",
      "2. **Key Varieties**: Mutable (`list`, `bytearray`) for dynamic data; immutable (`tuple`, `str`, `range`) for fixed integrity and hashable dictionary keys.",
      "3. **Standard Methods**: Leverage `.index()`, `.count()`, concatenation with `+`, and unpacking (`a, b = s`)."
    ]
  },
  {
    keywords: ["mutable vs immutable", "mutable and immutable", "mutability in python", "mutable types", "immutable types", "python mutability", "mutable", "immutable"],
    title: "Mutable vs Immutable in Python",
    simple: "In Python, mutable objects can be changed after they are created, like lists, dictionaries, and sets. Immutable objects cannot be changed once created—like numbers, strings, and tuples. If you modify an immutable object, Python actually creates a brand-new object in memory.",
    everyday: "In Python, mutability defines whether an object's state can be modified after creation. Mutable types include `list`, `dict`, and `set`, allowing in-place additions and updates with the same memory ID. Immutable types include `int`, `float`, `str`, `tuple`, and `frozenset`. When you modify an immutable object, Python creates a new object in memory. A key interview gotcha is avoiding mutable default arguments like `def append_to(item, target=[])`, which reuses the same list across function calls.",
    advanced: "In Python's object model, every object has an identity (`id()`), type, and value. For immutable types (`int`, `str`, `tuple`, `frozenset`), the value cannot be mutated post-instantiation; operations like string concatenation allocate new memory or utilize PyMalloc buffer pooling. Only immutable and hashable objects can serve as dictionary keys or set elements. Mutable default arguments in function definitions bind at compile time, leading to state persistence bugs, which are idiomatic to resolve using `target=None` and assigning inside the function.",
    points: [
      "**Mutable Types**: `list`, `dict`, `set`, and `bytearray` can be modified in-place without changing object identity (`id()`).",
      "**Immutable Types**: `int`, `float`, `str`, `tuple`, and `frozenset` cannot change; modifications allocate new objects.",
      "**Dictionary Keys**: Only immutable, hashable types can be used as dictionary keys and set members.",
      "**Default Argument Gotcha**: Never use mutable defaults like `def fn(items=[])`; use `items=None` instead."
    ],
    steps: [
      "1. **Core Distinction**: Mutable types permit in-place mutation; immutable types are fixed in memory once created.",
      "2. **Hashability**: Immutability is required for hash table keys (dicts and sets) to ensure consistent hash codes.",
      "3. **Function Arguments**: Pass by object reference—mutating a passed mutable object affects the caller, whereas reassigning does not."
    ]
  },
  {
    keywords: ["memory management", "garbage collection", "python memory", "reference counting", "cyclic garbage collection", "gc module", "how python manages memory"],
    title: "Python Memory Management & Garbage Collection",
    simple: "Python manages memory automatically using two systems. First, it counts how many references point to an object, and deletes it immediately when that count hits zero. Second, for circular references where two objects point to each other, Python has a periodic garbage collector that finds and clears them.",
    everyday: "Python manages memory through a combination of reference counting and a generational cyclic garbage collector (`gc` module). Every object tracks its reference count; when references drop to zero, memory is freed immediately. To handle reference cycles (where object A points to B and B points to A), Python runs a cyclic detector categorized into 3 generations (0, 1, and 2), inspecting young objects frequently and surviving objects less often. Underneath, CPython uses PyMalloc to allocate small objects (< 512 bytes) inside pre-allocated pools to avoid system fragmentation.",
    advanced: "CPython memory architecture operates at three tiers: the OS allocator, PyMalloc for small objects (<= 512 bytes) organized into 256KB arenas, 4KB pools, and size-specific blocks, and the standard Python object layer. Primary deallocation is deterministic reference counting (`ob_refcnt`). Non-zero circular references are collected by a generational cyclic garbage collector utilizing doubly-linked object headers (`PyGC_Head`). The GC tracks 3 generations with heuristic thresholds, executing Mark-and-Sweep while temporarily decrementing trial reference counts to detect unreachable cycles.",
    points: [
      "**Reference Counting**: Deterministic, immediate deallocation as soon as an object's reference count drops to 0.",
      "**Generational Cyclic GC**: Handles circular references across generations 0, 1, and 2 using heuristic thresholds.",
      "**PyMalloc Allocator**: Manages small objects (<= 512 bytes) in 256KB arenas and 4KB pools to minimize heap fragmentation.",
      "**Optimization & Control**: The `gc` module provides `gc.collect()`, `gc.disable()`, and weak references (`weakref`) to prevent cycles."
    ],
    steps: [
      "1. **Reference Counting**: Primary mechanism; increments on assignment, decrements on `del` or scope exit.",
      "2. **Cycle Detection**: Secondary mechanism; generational collection resolves self-referential or cyclic graph structures.",
      "3. **Best Practices**: Use `weakref` for caches and observer patterns to prevent memory leaks from unintentional references."
    ]
  },
  {
    keywords: ["decorator", "decorators", "python decorator", "function decorator", "@functools", "wraps"],
    title: "Python Decorators",
    simple: "A decorator in Python is a tool that lets you add extra behavior to an existing function without changing its code. It uses the '@' symbol above the function name, commonly used for logging, checking if a user is logged in, or timing how long code takes.",
    everyday: "In Python, a decorator is a design pattern that wraps a function to extend or modify its behavior without permanently altering its source code. Decorators take a function as an argument, define an inner wrapper function that accepts `*args` and `**kwargs`, and return that wrapper. In production code, you should always use `@functools.wraps(func)` on the inner wrapper to preserve the original function's name, docstring, and metadata.",
    advanced: "Decorators in Python are higher-order functions that leverage closures and the `@` syntactic sugar (PEP 318). A decorator receives callable `f` and returns callable `g`. To maintain introspective parity, `@functools.wraps` copies `__name__`, `__doc__`, `__module__`, and `__annotations__` via `functools.update_wrapper`. Decorators can also accept arguments by introducing an outer parameterized factory layer returning the actual decorator. Common enterprise applications include `@lru_cache`, authentication guards, distributed tracing, and retry logic.",
    points: [
      "**Core Concept**: A function that takes another function as input and returns an enhanced wrapper function.",
      "**Syntactic Sugar**: `@my_decorator` placed above a function definition is equivalent to `func = my_decorator(func)`.",
      "**Metadata Preservation**: Always apply `@functools.wraps(func)` on the wrapper to keep docstrings and function names intact.",
      "**Production Uses**: Logging, execution timing, authentication/authorization, caching (`@lru_cache`), and rate limiting."
    ],
    steps: [
      "1. **Define Wrapper**: Create an outer function taking `func`, an inner wrapper taking `*args, **kwargs`, and return `wrapper`.",
      "2. **Preserve Metadata**: Annotate the inner wrapper with `@functools.wraps(func)`.",
      "3. **Apply Cleanly**: Decorate target functions with `@decorator_name` or chain multiple decorators top-down."
    ]
  },
  {
    keywords: ["generator", "generators", "yield", "iterator", "iterators", "iter", "next", "python generator"],
    title: "Generators and Iterators in Python",
    simple: "In Python, an iterator is an object that lets you step through items one by one. A generator is the easiest way to make an iterator using the 'yield' keyword. Instead of returning everything at once and using lots of computer memory, a generator produces one item at a time only when you ask for it.",
    everyday: "In Python, an iterator is any object that implements the iterator protocol: `__iter__()` returning self, and `__next__()` returning values until raising `StopIteration`. A generator is a special function that simplifies creating iterators using the `yield` statement. When called, a generator returns a generator object that evaluates lazily, meaning it produces items on the fly in O(1) memory instead of holding a huge list in RAM.",
    advanced: "Generators are resumable coroutines implemented as stack-frame state machines in CPython. When execution encounters `yield`, the function's execution frame (`f_lasti`, local variables, instruction pointer) is suspended and yields control back to the caller. Calling `next()` resumes execution immediately after the yield point. Generators also support two-way communication via `.send(val)`, `.throw(exc)`, and `.close()`. They provide O(1) memory streaming for processing large datasets, CSVs, or unbounded sequences.",
    points: [
      "**Lazy Evaluation**: Values are calculated on demand, consuming O(1) constant memory regardless of stream size.",
      "**Yield vs Return**: `yield` temporarily pauses the function and retains its internal state; `return` terminates execution.",
      "**Iterator Protocol**: Implements `__iter__()` and `__next__()`, terminating with a `StopIteration` exception.",
      "**Use Cases**: Reading large files line by line, generating infinite numeric streams, and building data processing pipelines."
    ],
    steps: [
      "1. **Define with Yield**: Write a standard function containing one or more `yield` statements.",
      "2. **Consume Lazily**: Iterate over the generator using a `for` loop, `next()`, or generator expressions `(x for x in data)`.",
      "3. **Memory Advantage**: Use generators instead of list comprehensions whenever the entire collection does not need to sit in RAM."
    ]
  },
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
  if (/(write|show|give|implement|create|generate|draft).{0,30}(code|function|method|program|script|implementation|solution)/i.test(q)) return true;
  if (/^(code|python code|write code|show code|give me.*code)/i.test(q.trim())) return true;
  if (/write.*python/i.test(q) || /python.*(code|function|program|script)/i.test(q)) return true;
  if (/(implement|define).{0,30}(function|class|dict|dictionary|list|palindrome|linked list|two sum)/i.test(q)) return true;
  if (/(code|solution|program)\s+(for|to)\s+(palindrome|linked list|two sum|reverse|anagram|fibonacci|binary search)/i.test(q)) return true;
  if (/palindrome/i.test(q)) return true;
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
    // 1. Palindrome: simplest, most efficient and easily explainable
    if (/palindrome/.test(q)) {
      return `def is_palindrome(s: str) -> bool:
    # 1. Clean string: keep only lowercase alphanumeric characters
    clean = "".join(c.lower() for c in s if c.isalnum())
    # 2. Check if clean string equals its reverse slice
    return clean == clean[::-1]

# Tests:
print(is_palindrome("racecar"))  # True
print(is_palindrome("A man, a plan, a canal: Panama"))  # True
print(is_palindrome("hello"))    # False`;
    }
    // 2. Two Sum: simple single-pass hash map
    if (/two ?sum/.test(q)) {
      return `def two_sum(nums: list[int], target: int) -> list[int]:
    seen = {}  # maps number to its index
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []

# Test:
print(two_sum([2, 7, 11, 15], 9))  # [0, 1]`;
    }
    // 3. Reverse String
    if (/reverse.*(string|word)|string.*reverse/.test(q)) {
      return `def reverse_string(s: str) -> str:
    # Python slice [::-1] reverses the string efficiently in O(N)
    return s[::-1]

# Test:
print(reverse_string("hello"))  # "olleh"`;
    }
    // 4. Anagram
    if (/anagram/.test(q)) {
      return `from collections import Counter

def is_anagram(s: str, t: str) -> bool:
    # Compare character frequencies
    return Counter(s) == Counter(t)

# Test:
print(is_anagram("listen", "silent"))  # True`;
    }
    // 5. Binary Search: clean iterative standard
    if (/binary ?search/.test(q)) {
      return `def binary_search(nums: list[int], target: int) -> int:
    left, right = 0, len(nums) - 1
    while left <= right:
        mid = (left + right) // 2
        if nums[mid] == target:
            return mid
        elif nums[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1

# Test:
print(binary_search([1, 3, 5, 7, 9], 7))  # 3`;
    }
    // 6. Fibonacci: clean O(1) space loop
    if (/fibonacci|fib\b/.test(q)) {
      return `def fibonacci(n: int) -> int:
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

# Test:
print(fibonacci(7))  # 13`;
    }
    if (/linked ?list|node.*next/.test(q)) {
      return `class Node:
    def __init__(self, data):
        self.data = data
        self.next = None

class LinkedList:
    def __init__(self):
        self.head = None

    def append(self, data):
        new_node = Node(data)
        if not self.head:
            self.head = new_node
            return
        curr = self.head
        while curr.next:
            curr = curr.next
        curr.next = new_node

    def display(self):
        curr = self.head
        while curr:
            print(curr.data, end=" -> ")
            curr = curr.next
        print("None")

# Usage:
ll = LinkedList()
ll.append(10)
ll.append(20)
ll.display()  # 10 -> 20 -> None`;
    }
    if (/implement.*(dict|dictionary|hash ?map)|how.*(dict|dictionary).*implemented/.test(q)) {
      return `class SimpleHashMap:
    """Basic hash table implementation demonstrating chaining."""
    def __init__(self, size=16):
        self.size = size
        self.buckets = [[] for _ in range(size)]

    def _hash(self, key):
        return hash(key) % self.size

    def set(self, key, value):
        idx = self._hash(key)
        for i, (k, v) in enumerate(self.buckets[idx]):
            if k == key:
                self.buckets[idx][i] = (key, value)
                return
        self.buckets[idx].append((key, value))

    def get(self, key, default=None):
        idx = self._hash(key)
        for k, v in self.buckets[idx]:
            if k == key:
                return v
        return default

# Usage:
d = SimpleHashMap()
d.set("python", 3.12)
print(d.get("python"))  # 3.12`;
    }
    if (/dict|key.?value|hash ?map/.test(q)) {
      return `user_scores = {"ana": 92, "ben": 85}
user_scores["cara"] = 90

average = sum(user_scores.values()) / len(user_scores)
print(f"Average: {average:.1f}")
print(user_scores.get("dan", "not found"))`;
    }
    if (/list|tuple/.test(q)) {
      return `items = [3, 1, 2]
items.append(4)
coords = (10, 20)

for item in sorted(items):
    print(item)
print(f"Point: {coords[0]}, {coords[1]}")`;
    }
    if (/dataset|dataframe|pandas|csv/.test(q)) {
      return `import pandas as pd

df = pd.read_csv("data.csv")
df = df.dropna()
print(df.head())
print(df.describe())`;
    }
    if (/async|await|event loop/.test(q)) {
      return `import asyncio
import httpx

async def fetch_titles(urls: list[str]) -> list[str]:
    async with httpx.AsyncClient() as client:
        results = []
        for url in urls:
            response = await client.get(url)
            results.append(response.text[:100])
        return results`;
    }
    if (/api|rest|http|flask|fastapi/.test(q)) {
      return `from fastapi import FastAPI

app = FastAPI()

@app.get("/users/{user_id}")
def get_user(user_id: int):
    return {"user_id": user_id, "name": "Ana"}`;
    }
    // Generic fallback: exact runnable Python, no paragraph wrapper.
    return `def solve(items: list[int]) -> list[int]:
    seen: dict[int, int] = {}
    result: list[int] = []
    for item in items:
        if item not in seen:
            seen[item] = 1
            result.append(item)
    return result


if __name__ == "__main__":
    print(solve([3, 1, 2, 1, 3]))`;
  }
  if (language === "sql") {
    return `SELECT department, AVG(salary) AS avg_salary
FROM employees
WHERE active = TRUE
GROUP BY department
ORDER BY avg_salary DESC;`;
  }
  if (language === "javascript") {
    if (/palindrome/.test(q)) {
      return `function isPalindrome(str) {
  const clean = str.toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean === clean.split("").reverse().join("");
}

console.log(isPalindrome("racecar")); // true`;
    }
    return `function unique(items) {
  return [...new Set(items)];
}

console.log(unique([3, 1, 2, 1, 3]));`;
  }
  return `public class Main {
  public static void main(String[] args) {
    System.out.println("Hello");
  }
};`;
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
  const company = (preferences.company || "").trim();
  const companyFocus = company ? findCompany(company)?.focus || "" : "";
  const atCompany = company ? ` at ${company}` : "";
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
      ? (vague ? "Here is a clean starting point. Tell me the exact task and I will tailor it." : `Here is how I would write it${atCompany}.`)
      : (vague ? "Here is a clean starting point I use. Tell me the exact inputs and edge cases and I will tailor it." : `Here is how I would write it in my own work${atCompany}.`);
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
    const forCompany = company ? ` for ${company}` : "";

    if (delivery === "talking_points") {
      const bullets = length === "concise" ? topic.points.slice(0, 3) : topic.points;
      const tail = companyFocus ? `\n\nAt ${company}, I emphasize ${companyFocus}.` : "";
      const answer = `${opener}Here is the key breakdown of ${topic.title}${forCompany}:\n\n` + bullets.map(p => `• ${p}`).join("\n\n") + tail;
      return { answer, keywords: qWords };
    }

    if (delivery === "structured") {
      const steps = length === "concise" ? topic.steps.slice(0, 2) : topic.steps;
      const tail = companyFocus ? `\n\nAt ${company}, I emphasize ${companyFocus}.` : "";
      const answer = `${opener}Here is how I explain ${topic.title} step-by-step${forCompany}:\n\n` + steps.join("\n\n") + tail;
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
    if (companyFocus && length !== "concise") {
      coreText += ` At ${company}, they focus on ${companyFocus}, so I frame my answer that way.`;
    }
    // Voice: speak as "I" so the candidate can say it naturally.
    let voiceText = coreText
      .replace(/^In Python,\s*a dictionary is\b/i, "I use a Python dictionary when I need")
      .replace(/^In Python,\s*/i, "In my work I ")
      .replace(/^A (REST API|database index|database)/i, "I treat a $1");
    if (!/\bI\b/.test(voiceText.slice(0, 60))) {
      voiceText = (tone === "casual" ? "In my work, " : `In my work as a ${role}${atCompany}, `) + voiceText.charAt(0).toLowerCase() + voiceText.slice(1);
    } else if (company && !voiceText.slice(0, 120).includes(company)) {
      voiceText = voiceText.replace(/^In my work as a ([^,]+), /, `In my work as a $1${atCompany}, `);
    }

    const answer = stripPointers(`${opener}${voiceText}`);
    return { answer, keywords: qWords };
  }

  // If the question is about personal experience or not in static topics
  // If the question is about personal experience or not in static topics
  const hasEvidence = evidence.length > 0 && Boolean(evidence[0]?.text);
  const isProjectQuery = /(recent|project|projects|work|built|worked on|experience|resume|background)/i.test(question);

  // Clean evidence snippet for natural speaking: remove bullet symbols, document headers, raw markdown
  const cleanEvidence = (hasEvidence ? evidence[0].text : `architecting scalable applications as a ${role}`)
    .replace(/^[\s•\-\*\d+\.]+\s*/gm, "")
    .replace(/^(Section\s+\d+|Candidate\s+Background|Technical\s+expertise|Document:)\s*:?/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = cleanEvidence.split(/(?<=[.?!])\s+/);
  const coreEvidenceStatement = sentences.length > 1
    ? `${sentences[0]} ${sentences[1]}`
    : (sentences[0] || cleanEvidence.slice(0, 160));

  if (delivery === "talking_points") {
    const answer = `Here are the key points regarding this from my experience as a ${role}${atCompany}:

• **Core Approach**: I focus on understanding constraints early, designing modular systems, and ensuring reliable execution.
• **Practical Experience**: ${coreEvidenceStatement.slice(0, 180)}
• **Outcome**: Consistently delivered high uptime, maintainable code, and scalable team delivery.${companyFocus ? `\n\nAt ${company}, I emphasize ${companyFocus}.` : ""}`;
    return { answer, keywords: qWords };
  }

  if (delivery === "structured") {
    const answer = `Here is my structured approach to this:

1. **Analysis & Strategy**: Establish clear system requirements, identify edge cases, and choose the right tools for the job.
2. **Implementation**: Applied in practice through ${coreEvidenceStatement.slice(0, 180)}
3. **Validation & Iteration**: Backed by automated testing, continuous integration, and performance benchmarking.`;
    return { answer, keywords: qWords };
  }

  // Natural answer
  const intro = tone === "casual"
    ? `In my experience as a ${role}${atCompany}, `
    : tone === "friendly"
    ? `From my background as a ${role}${atCompany}, `
    : `As a ${role}${atCompany}, `;

  let answer = "";
  if (isProjectQuery && hasEvidence) {
    answer = length === "concise"
      ? `${intro}in my recent project, I focused on ${coreEvidenceStatement.charAt(0).toLowerCase() + coreEvidenceStatement.slice(1)}. I took ownership of the core system design, optimized performance, and ensured clean delivery.`
      : `${intro}in my recent project, I worked on ${coreEvidenceStatement.charAt(0).toLowerCase() + coreEvidenceStatement.slice(1)}. My focus was on architecting reliable components, ensuring high availability, and delivering scalable solutions across our engineering stack.`;
  } else {
    answer = length === "concise"
      ? `${intro}I focus on building reliable, clean solutions. In my recent work, I focused on ${coreEvidenceStatement.charAt(0).toLowerCase() + coreEvidenceStatement.slice(1)}, ensuring high performance and maintainable architecture.`
      : `${intro}I approach this by breaking down the problem into clear, testable components. In my work, I focused on ${coreEvidenceStatement.charAt(0).toLowerCase() + coreEvidenceStatement.slice(1)}, ensuring high availability, clean separation of concerns, and smooth delivery across the team.`;
  }

  return { answer, keywords: qWords };
}
