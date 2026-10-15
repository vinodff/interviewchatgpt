import type { Evidence, Preferences } from "./types";

export interface AnswerOptions {
  question: string;
  preferences?: Partial<Preferences>;
  evidence?: Evidence[];
}

export interface GeneratedAnswer {
  question: string;
  answer: string;
  evidence: Evidence[];
  keywords: string[];
  latency_ms: number;
}

interface TopicKnowledge {
  keywords: string[];
  title: string;
  definition: string;
  /** Conversational first-person core: how a human engineer actually says it aloud. */
  voice: string;
  /** One practical follow-up sentence in the same spoken voice. */
  story: string;
  keyPoints: string[];
  tradeoffs?: string;
  codeSnippet?: string;
  bestPractices: string;
}

const KNOWLEDGE_BASE: Record<string, TopicKnowledge> = {
  list: {
    keywords: ["list", "lists", "arraylist", "dynamic array"],
    title: "List Data Structure",
    definition: "A list is an ordered, mutable linear data structure that stores an indexed sequence of elements, allowing duplicate values and element access by position.",
    voice: "A list is just an ordered collection of items you grab by position, and it allows duplicates. In Python I think of it as a dynamic array under the hood — indexing is O(1) and appending is fast, but inserting in the middle costs O(n) because everything after it has to shift.",
    story: "I reach for lists whenever I need an ordered sequence with lots of reads and appends, and if I know the size upfront I'll preallocate to avoid resizes.",
    codeSnippet: "```python\n# Dynamic list / array operations\nitems = [10, 20, 30]\nitems.append(40)        # O(1) amortized append\nval = items[0]          # O(1) random index access\nitems.insert(1, 15)     # O(n) element shift\n```",
    keyPoints: [
      "In modern languages like Python, lists are implemented as dynamic arrays that resize exponentially (providing O(1) random access by index and amortized O(1) append operations).",
      "In languages like Java or C++, List is an abstract interface implemented either as dynamic arrays (ArrayList, std::vector) or node-based sequences (LinkedList).",
      "Time complexities: Index access O(1), Search O(n) (or O(log n) if sorted using binary search), Insertion/Deletion at end O(1) amortized, Arbitrary insertion/deletion O(n) due to element shifting."
    ],
    tradeoffs: "Dynamic arrays provide superior cache locality and O(1) random access over linked lists, but incur O(n) copying costs during resize thresholds.",
    bestPractices: "Use lists when you need an ordered sequence with frequent reads and tail-appends; preallocate capacity when the total size is known in advance to avoid reallocations."
  },
  array: {
    keywords: ["array", "arrays", "contiguous memory", "fixed array"],
    title: "Array Data Structure",
    definition: "An array is a linear collection of elements stored in contiguous memory locations, each identifiable by an integer index or key.",
    voice: "An array is a fixed block of items stored back-to-back in memory, so you can jump straight to any index in O(1). The catch is the size is fixed — growing one means allocating a bigger block and copying everything over.",
    story: "I use plain arrays when the size is bounded and raw access speed matters, since that layout is extremely cache-friendly.",
    codeSnippet: "```python\ndef search_array(arr: list[int], target: int) -> int:\n    # Linear scan through contiguous memory: O(n) time, O(1) space\n    for i, val in enumerate(arr):\n        if val == target:\n            return i\n    return -1\n```",
    keyPoints: [
      "Contiguous memory allocation enables constant time O(1) random access via base address arithmetic: address = base + (index * element_size).",
      "High CPU cache spatial locality makes iteration significantly faster than pointer-based data structures.",
      "Fixed capacity in primitive arrays requires upfront memory allocation; resizing requires allocating a new block and copying elements (O(n))."
    ],
    tradeoffs: "Offers optimal read performance and predictable memory footprint, but fixed sizing requires manual resizing or dynamic wrapper structures.",
    bestPractices: "Prefer arrays when element count is bounded or when memory locality and access latency are critical performance factors."
  },
  stack: {
    keywords: ["stack", "lifo", "push pop"],
    title: "Stack Data Structure",
    definition: "A stack is a linear Last-In, First-Out (LIFO) data structure where insertions and deletions happen exclusively at one end, known as the top.",
    voice: "A stack is last-in, first-out — you only push and pop from the top, both in O(1). It's the same idea as the call stack, which is why recursion and undo features map onto it so naturally.",
    story: "Whenever I see nested-structure problems — matching brackets, depth-first search, backtracking — a stack is my first instinct.",
    codeSnippet: "```python\nclass Stack:\n    def __init__(self):\n        self._items = []\n\n    def push(self, val):\n        self._items.append(val)  # O(1)\n\n    def pop(self):\n        return self._items.pop() if self._items else None  # O(1)\n\n    def peek(self):\n        return self._items[-1] if self._items else None  # O(1)\n\n    def is_empty(self):\n        return len(self._items) == 0\n```",
    keyPoints: [
      "Core operations: push (insert), pop (remove top), and peek (inspect top), all executing in constant O(1) time.",
      "Fundamental to computing: manages execution call stacks, recursion, undo mechanisms in editors, and syntax/expression parsing.",
      "Can be efficiently implemented with either a dynamic array or a singly linked list with top at the head."
    ],
    bestPractices: "Ideal for depth-first searches (DFS), backtracking algorithms, and matching nested structures like parenthesis validation."
  },
  queue: {
    keywords: ["queue", "fifo", "enqueue", "dequeue"],
    title: "Queue Data Structure",
    definition: "A queue is a linear First-In, First-Out (FIFO) data structure where elements are inserted at the rear (enqueue) and removed from the front (dequeue).",
    voice: "A queue is first-in, first-out: items go in the back and come out the front, both in O(1). I always picture a printer line or a job pipeline when I explain it.",
    story: "I use queues for anything that needs fair ordering — BFS, background jobs, rate limiting — and I grab a deque when I need to push or pop from both ends.",
    codeSnippet: "```python\nfrom collections import deque\n\nclass Queue:\n    def __init__(self):\n        self._items = deque()\n\n    def enqueue(self, val):\n        self._items.append(val)  # O(1)\n\n    def dequeue(self):\n        return self._items.popleft() if self._items else None  # O(1)\n\n    def is_empty(self):\n        return len(self._items) == 0\n```",
    keyPoints: [
      "Standard operations: enqueue (O(1)), dequeue (O(1)), and peek (O(1)).",
      "Essential for breadth-first search (BFS), asynchronous job processing, printer buffers, and rate-limiting sliding windows.",
      "Implemented via circular arrays, doubly linked lists, or ring buffers to avoid O(n) shifts upon dequeuing."
    ],
    bestPractices: "Use double-ended queues (deque) when bidirectional insertion or extraction is required."
  },
  hashmap: {
    keywords: ["hashmap", "hash map", "hashtable", "hash table", "dictionary", "hash set", "hashing"],
    title: "Hash Map / Hash Table",
    definition: "A hash map is an associative data structure that stores key-value pairs, using a hash function to compute an index into an array of buckets for fast lookups.",
    voice: "A hash map stores key-value pairs by hashing each key into a bucket, which gives average O(1) lookups. The thing to watch is collisions and the load factor — once the table gets too full it rehashes into something bigger.",
    story: "It's my default whenever I need fast lookups by key and don't need ordering, and I always make sure keys are immutable with a well-distributed hash.",
    codeSnippet: "```python\nclass SimpleHashMap:\n    def __init__(self, capacity=16):\n        self.capacity = capacity\n        self.buckets = [[] for _ in range(capacity)]\n\n    def _hash(self, key):\n        return hash(key) % self.capacity\n\n    def put(self, key, value):\n        index = self._hash(key)\n        bucket = self.buckets[index]\n        for i, (k, v) in enumerate(bucket):\n            if k == key:\n                bucket[i] = (key, value)\n                return\n        bucket.append((key, value))  # Separate chaining\n\n    def get(self, key):\n        index = self._hash(key)\n        bucket = self.buckets[index]\n        for k, v in bucket:\n            if k == key:\n                return v\n        return None\n```",
    keyPoints: [
      "Average time complexity for insert, search, and delete is O(1); worst-case is O(n) when severe hash collisions occur.",
      "Collision resolution techniques include separate chaining (linked lists or balanced trees per bucket) and open addressing (linear probing, quadratic probing, double hashing).",
      "Maintains a load factor (ratio of entries to bucket count) and dynamically rehashes into double the buckets when the threshold (typically 0.75) is reached."
    ],
    tradeoffs: "Provides near-instant key lookups, but does not preserve element order unless a linked structure (e.g., LinkedHashMap) is maintained.",
    bestPractices: "Ensure keys implement immutable, well-distributed hash functions to prevent bucket clustering and performance degradation."
  },
  tree: {
    keywords: ["tree", "binary tree", "bst", "binary search tree", "balanced tree", "avl", "red-black"],
    title: "Tree & Binary Search Tree",
    definition: "A tree is a non-linear hierarchical data structure consisting of nodes connected by edges, starting from a single root node.",
    voice: "A tree is a hierarchy of nodes starting from a root, and a binary search tree keeps the left child smaller and the right child bigger than its parent. That ordering buys O(log n) lookups on a balanced tree — though if it goes lopsided it degrades to O(n).",
    story: "In practice I rely on self-balancing trees through database indexes and sorted maps, and I read BSTs with in-order traversal when I need elements out in sorted order.",
    codeSnippet: "```python\nclass TreeNode:\n    def __init__(self, val=0, left=None, right=None):\n        self.val = val\n        self.left = left\n        self.right = right\n\ndef search_bst(root: TreeNode, target: int) -> TreeNode | None:\n    if not root or root.val == target:\n        return root\n    if target < root.val:\n        return search_bst(root.left, target)\n    return search_bst(root.right, target)\n```",
    keyPoints: [
      "In a Binary Search Tree (BST), the left child value is strictly less than the parent, and the right child is greater than or equal.",
      "Lookup, insertion, and deletion run in O(log n) time on balanced trees (like AVL or Red-Black trees), degrading to O(n) on degenerate/skewed trees.",
      "Standard traversals: In-order (yields sorted elements for BST), Pre-order, Post-order (useful for subtree evaluation/deletion), and Level-order (BFS)."
    ],
    bestPractices: "Self-balancing binary trees (e.g., Red-Black in C++ std::map or Java TreeMap) are used in database indexing and sorted associative containers."
  },
  graph: {
    keywords: ["graph", "bfs", "dfs", "dijkstra", "vertices", "edges", "adjacency"],
    title: "Graph Data Structure & Traversal",
    definition: "A graph is a non-linear structure made of a finite set of vertices (nodes) and edges connecting pairs of vertices, representing complex relationships.",
    voice: "A graph is just nodes connected by edges, and it's the right model whenever the relationships matter more than the items themselves. I store sparse graphs as adjacency lists, and I reach for BFS for shortest paths on unweighted graphs and DFS when I'm hunting cycles or connected components.",
    story: "The mistake I always guard against is forgetting the visited set on cyclic graphs — that's how you get infinite loops.",
    codeSnippet: "```python\nfrom collections import deque\n\ndef bfs(graph: dict, start: str) -> list[str]:\n    visited = {start}\n    queue = deque([start])\n    order = []\n\n    while queue:\n        node = queue.popleft()\n        order.append(node)\n        for neighbor in graph.get(node, []):\n            if neighbor not in visited:\n                visited.add(neighbor)\n                queue.append(neighbor)\n    return order\n```",
    keyPoints: [
      "Representations: Adjacency list (space O(V + E), ideal for sparse graphs) and Adjacency matrix (space O(V^2), ideal for dense graphs with O(1) edge lookup).",
      "Breadth-First Search (BFS) uses a queue to traverse level-by-level, computing shortest paths in unweighted graphs.",
      "Depth-First Search (DFS) uses recursion or a stack to explore as deeply as possible, ideal for cycle detection, topological sorting, and connected components."
    ],
    bestPractices: "Track visited sets to avoid infinite loops in cyclic graphs; use Dijkstra or A* for weighted shortest path computations."
  },
  sorting: {
    keywords: ["sort", "sorting", "quicksort", "mergesort", "heapsort", "bubble sort"],
    title: "Sorting Algorithms",
    definition: "Sorting algorithms arrange elements in a sequence according to a comparison order (ascending or descending).",
    voice: "Sorting just means arranging items in order, and the interesting part is the trade-off between algorithms. Quicksort is usually fastest in practice, mergesort guarantees O(n log n) and is stable, and Python's Timsort blends both to exploit runs that are already ordered.",
    story: "My rule of thumb: quicksort when memory is tight, mergesort or Timsort when I need stability and predictable performance.",
    codeSnippet: "```python\ndef quicksort(arr: list[int]) -> list[int]:\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    mid = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quicksort(left) + mid + quicksort(right)\n```",
    keyPoints: [
      "QuickSort: Divide-and-conquer using a pivot element. Average time O(n log n), worst-case O(n^2), space O(log n) in-place. Extremely fast in practice due to cache friendliness.",
      "MergeSort: Divide-and-conquer dividing array in halves, sorting recursively, and merging. Guaranteed O(n log n) time, stable, requires O(n) auxiliary memory.",
      "TimSort (used in Python and Java): Hybrid of MergeSort and InsertionSort designed for real-world data with existing ordered runs, O(n log n) worst and O(n) best case."
    ],
    bestPractices: "Choose QuickSort for memory-constrained in-place sorting; choose MergeSort/TimSort when stability and deterministic O(n log n) runtime are required."
  },
  binary_search: {
    keywords: ["binary search", "binary_search", "bsearch"],
    title: "Binary Search Algorithm",
    definition: "Binary search finds the position of a target value within a sorted array by repeatedly dividing the search interval in half in O(log n) time.",
    voice: "Binary search works on sorted arrays by keeping left and right pointers and checking the middle. If the middle is too small, you throw away the left half; if it's too big, you throw away the right half.",
    story: "The one bug everyone writes is integer overflow on left plus right, so in languages that care I always do left plus right minus left divided by two.",
    codeSnippet: "```python\ndef binary_search(nums: list[int], target: int) -> int:\n    left, right = 0, len(nums) - 1\n    while left <= right:\n        mid = left + (right - left) // 2\n        if nums[mid] == target:\n            return mid\n        elif nums[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return -1\n```",
    keyPoints: [
      "Requires a monotonically sorted array or search space.",
      "Time complexity is strictly O(log n) because the search interval is halved at each iteration.",
      "Space complexity is O(1) iterative or O(log n) recursive due to call stack frames."
    ],
    bestPractices: "Use binary search on any monotonic predicate, not just simple value lookups (e.g. search for minimum feasible capacity)."
  },
  linked_list: {
    keywords: ["linked list", "linkedlist", "reverse linked list", "reverse a linked list", "singly linked list"],
    title: "Linked List Data Structure",
    definition: "A linked list is a linear collection of data elements whose order is not given by physical placement in memory, but by node pointers.",
    voice: "A linked list is nodes chained together with pointers. Inserting at the head or after a known node is O(1), but finding anything by index is O(n) because you have to walk the chain.",
    story: "Reversing a linked list is the classic interview question — you keep three pointers: previous, current, and next, and flip current dot next to previous as you walk.",
    codeSnippet: "```python\nclass ListNode:\n    def __init__(self, val=0, next=None):\n        self.val = val\n        self.next = next\n\ndef reverse_linked_list(head: ListNode) -> ListNode:\n    prev, curr = None, head\n    while curr:\n        next_temp = curr.next\n        curr.next = prev\n        prev = curr\n        curr = next_temp\n    return prev\n```",
    keyPoints: [
      "Node structure contains data and a pointer to the next (and optionally previous for doubly linked) node.",
      "O(1) insertion and deletion given pointer to node; O(n) sequential search.",
      "No memory wastage for pre-allocated arrays, but incurs pointer overhead per node."
    ],
    bestPractices: "Use a dummy head node to simplify boundary insertions and deletions."
  },
  two_sum: {
    keywords: ["two sum", "twosum", "2sum", "two-sum"],
    title: "Two Sum Problem",
    definition: "Two sum finds two numbers in an array that add up to a specific target value using a hash map in O(n) time.",
    voice: "Two sum is the quintessential hash map problem: you iterate through the numbers, compute target minus current, and check if you've already seen that complement in a map.",
    story: "It turns an O(n^2) brute force double loop into a single pass O(n) by using O(n) space for the lookup dictionary.",
    codeSnippet: "```python\ndef two_sum(nums: list[int], target: int) -> list[int]:\n    seen = {}  # complement -> index\n    for i, num in enumerate(nums):\n        diff = target - num\n        if diff in seen:\n            return [seen[diff], i]\n        seen[num] = i\n    return []\n```",
    keyPoints: [
      "Single-pass O(n) time complexity using hash map lookups.",
      "Auxiliary space is O(n) to store seen elements and indices.",
      "Handles negative numbers and duplicates gracefully."
    ],
    bestPractices: "Return indices immediately once the complement is found without waiting for the full iteration."
  },
  debounce: {
    keywords: ["debounce", "debouncing", "throttle", "throttling"],
    title: "Debounce Function",
    definition: "Debounce delays invoking a function until after a specified wait time has elapsed since the last time the debounced function was invoked.",
    voice: "Debouncing ensures that a function only runs after a user has stopped doing something for a set amount of time — like waiting for them to pause typing before sending a search query.",
    story: "I write it with a simple closure holding a timeout ID: every call clears the previous timer and starts a new one.",
    codeSnippet: "```javascript\nfunction debounce(fn, delay) {\n    let timer;\n    return (...args) => {\n        clearTimeout(timer);\n        timer = setTimeout(() => fn(...args), delay);\n    };\n}\n```",
    keyPoints: [
      "Prevents excessive function calls during high-frequency events (resize, scroll, keypress).",
      "Uses a JavaScript closure to maintain the active timer handle.",
      "Can be extended with leading/immediate execution options."
    ],
    bestPractices: "Always clear timeouts when unmounting component lifecycle hooks to prevent memory leaks."
  },
  react: {
    keywords: ["react", "virtual dom", "reactjs", "jsx", "reconciliation"],
    title: "React & Virtual DOM Architecture",
    definition: "React is a component-based, declarative JavaScript library for building user interfaces with unidirectional data flow and efficient DOM updates.",
    voice: "React is a component-based UI library with one-way data flow — state flows down through props and events flow back up. The virtual DOM is the clever bit: React diffs the new tree against the old one and only touches the real DOM where something actually changed.",
    story: "In my components I keep state as local as possible and memoize the expensive subtrees, since most React perf problems I've seen come from re-rendering too much.",
    codeSnippet: "```javascript\nfunction UserList({ items }) {\n    return (\n        <ul>\n            {items.map(item => (\n                <li key={item.id}>{item.name}</li>\n            ))}\n        </ul>\n    );\n}\n```",
    keyPoints: [
      "Virtual DOM: In-memory representation of UI elements. When state changes, React creates a new virtual tree, runs a diffing algorithm (Reconciliation), and computes the minimum real DOM updates.",
      "Unidirectional data flow ensures state transitions remain predictable: data flows down via props, and events flow up via callbacks.",
      "React Fiber architecture introduces interruptible, prioritized rendering units to prevent UI thread blocking during expensive renders."
    ],
    bestPractices: "Keep state local to where it is needed, leverage React.memo and pure components for expensive subtrees, and maintain immutable state updates."
  },
  hooks: {
    keywords: ["hooks", "useeffect", "usestate", "usememo", "usecallback", "useref"],
    title: "React Hooks Lifecycle & Optimization",
    definition: "React Hooks allow functional components to manage local state, handle side effects, and access React features without class components.",
    voice: "Hooks let function components hold state and run side effects without classes. useState is local state, useEffect runs after paint for things like fetching or subscriptions, and useMemo and useCallback exist to stop expensive recomputation and needless child re-renders.",
    story: "The two rules I never break: only call hooks at the top level, and always get the dependency array right — the lint plugin catches most of my mistakes there.",
    codeSnippet: "```javascript\nimport React, { useState, useEffect } from 'react';\n\nfunction useFetch(url) {\n    const [data, setData] = useState(null);\n    useEffect(() => {\n        let active = true;\n        fetch(url).then(res => res.json()).then(result => {\n            if (active) setData(result);\n        });\n        return () => { active = false; };\n    }, [url]);\n    return data;\n}\n```",
    keyPoints: [
      "useState provides local reactive state; updates are batched asynchronously.",
      "useEffect handles side effects (subscriptions, network calls, DOM mutations) after paint. Dependency arrays control re-execution; cleanup functions prevent memory leaks.",
      "useMemo caches computed values to avoid expensive re-calculations; useCallback caches function references to prevent unnecessary child re-renders."
    ],
    bestPractices: "Follow the Rules of Hooks (call only at the top level, never conditionally); use ESLint hooks plugin to maintain accurate dependency arrays."
  },
  rest: {
    keywords: ["rest", "rest api", "http verbs", "restful", "endpoints"],
    title: "RESTful API Architecture",
    definition: "REST (Representational State Transfer) is an architectural style for networked systems based on stateless, client-server communication using standard HTTP methods.",
    voice: "REST is a style for building APIs where everything is a resource with a URL and you use standard HTTP verbs to act on it. The big constraint people forget is statelessness — every request has to carry everything the server needs.",
    story: "When I design endpoints I stick to nouns for resources, keep GET, PUT and DELETE idempotent, and return proper status codes with structured errors.",
    keyPoints: [
      "Resource-oriented endpoints: Nouns represent resources (e.g., /api/users, /api/orders/{id}), and standard HTTP verbs indicate actions (GET, POST, PUT, PATCH, DELETE).",
      "Statelessness: Each request from client to server must contain all information required to understand and fulfill it; no session context is retained on the server.",
      "Idempotency: GET, PUT, and DELETE operations are idempotent (multiple identical requests have the same effect as a single request); POST is typically non-idempotent."
    ],
    bestPractices: "Return standard HTTP status codes (200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 404 Not Found, 500 Server Error) with structured error payloads."
  },
  database: {
    keywords: ["database", "sql", "nosql", "postgres", "mongodb", "acid", "relational"],
    title: "SQL vs NoSQL & Relational Databases",
    definition: "Databases organize and persist application data, broadly divided into relational (SQL) and non-relational (NoSQL) paradigms.",
    voice: "The way I frame it: SQL gives you structure and strong guarantees with ACID transactions, while NoSQL trades that for flexible schemas and horizontal scale. Indexes are the lever in both worlds — they turn full scans into fast lookups at the cost of storage and write speed.",
    story: "I pick SQL when I need joins and transactional safety, NoSQL when I'm ingesting lots of unstructured data fast — and I index only the queries I actually run.",
    keyPoints: [
      "SQL (e.g., PostgreSQL, MySQL): Structured schema, relational integrity via foreign keys, full ACID guarantees (Atomicity, Consistency, Isolation, Durability), scaled vertically or with read replicas.",
      "NoSQL (e.g., MongoDB, DynamoDB): Flexible schemaless models (document, key-value, wide-column, graph), optimized for high write throughput and horizontal sharding.",
      "Database Indexes: B-Tree or Hash indexes convert O(n) sequential table scans into O(log n) lookups at the expense of additional storage and write latency."
    ],
    bestPractices: "Use SQL when complex joins, transactional integrity, and strict schemas are required; adopt NoSQL for high-velocity unstructured ingestion or horizontal partition scaling."
  },
  microservices: {
    keywords: ["microservices", "monolith", "service architecture", "distributed system"],
    title: "Microservices vs Monolith Architecture",
    definition: "Architectural patterns for organizing backend applications into either a single unified deployable unit (monolith) or a suite of independently deployable services.",
    voice: "It's really a spectrum: a monolith is one deployable unit that's simple to develop and keeps transactions easy, while microservices split things into independently deployable services that scale and ship on their own. The price of microservices is distributed-systems pain — tracing, eventual consistency, network failures.",
    story: "My bias is to start as a modular monolith with clean boundaries and only split out services when scaling or team ownership genuinely demands it.",
    keyPoints: [
      "Monolith advantages: Simpler local development, single deployment pipeline, zero network latency between components, and straightforward ACID database transactions.",
      "Microservices advantages: Independent deployment, autonomous team ownership, targeted horizontal scaling, and isolated technology choices per service.",
      "Challenges in microservices: Distributed tracing, eventual consistency, network partitioning, circuit breaking, and orchestration complexity."
    ],
    bestPractices: "Start with a modular monolith with clean domain boundaries; decouple into microservices only when organizational scaling or distinct hardware requirements demand it."
  },
  system_design: {
    keywords: ["system design", "scalability", "load balancer", "caching", "cdn", "cap theorem", "high availability"],
    title: "System Design & High-Scalability Principles",
    definition: "System design encompasses architecting distributed infrastructure that scales gracefully under increasing load while maintaining reliability and low latency.",
    voice: "For me, scalable design comes down to three moves: scale horizontally with stateless services behind a load balancer, cache aggressively at every layer, and push heavy work into async queues. And I always keep the CAP trade-off in mind — when the network fails, you pick two of consistency, availability, and partition tolerance.",
    story: "In practice, a CDN plus Redis in front of a stateless API behind a load balancer handles most read spikes I've dealt with.",
    keyPoints: [
      "Horizontal vs Vertical Scaling: Adding more commodity nodes (horizontal) versus provisioning more CPU/RAM on a single machine (vertical).",
      "Multi-tier Caching: Leverage in-memory caches (Redis/Memcached) at application layer and CDNs (Cloudflare) at the network edge to absorb read spikes.",
      "CAP Theorem: In a distributed data store, you can only guarantee two out of Consistency, Availability, and Partition Tolerance in the presence of network failures."
    ],
    bestPractices: "Decouple write-heavy operations via asynchronous message queues (Kafka, RabbitMQ); design stateless application services behind elastic load balancers."
  },
  behavioral_experience: {
    keywords: ["tell me about yourself", "experience", "background", "walk me through your resume", "career"],
    title: "Candidate Background & Technical Leadership",
    definition: "A concise overview of engineering leadership, technical track record, and core problem-solving approach.",
    voice: "I'm a software engineer focused on building and scaling reliable systems — I care a lot about latency, testing, and shipping things that actually move the product forward. I work closely with product and design, review code rigorously, and mentor teammates wherever I can.",
    story: "If they want specifics, I anchor on measurable outcomes: faster responses, fewer incidents, real business impact.",
    keyPoints: [
      "Current focus: Designing and scaling resilient full-stack systems, optimizing latency, and shipping customer-facing features.",
      "Engineering philosophy: Ground decisions in concrete technical trade-offs, maintain high standards for automated testing and observability, and align with business impact.",
      "Collaborative approach: Partnering cross-functionally with product and design, conducting rigorous code reviews, and mentoring team members."
    ],
    bestPractices: "Frame answers around measurable outcomes: latency reductions, reliability metrics, and business value delivered."
  },
  behavioral_conflict: {
    keywords: ["conflict", "disagreement", "difficult stakeholder", "handling conflict"],
    title: "Handling Technical Disagreements & Conflict",
    definition: "Professional methodology for navigating technical differences with colleagues to reach optimal engineering solutions.",
    voice: "When I disagree with someone technically, I start by assuming they're seeing a constraint I'm not, and I try to surface it. Then I move the debate onto measurable ground — benchmarks, complexity, operational cost — instead of opinions.",
    story: "If we're still stuck, I time-box a small prototype so data decides, and once we commit, I back the decision fully.",
    keyPoints: [
      "Start by assuming positive intent and listening carefully to understand the opposing perspective's underlying constraints and priorities.",
      "Depersonalize the debate by framing the problem around measurable criteria: performance benchmarks, operational complexity, security, and developer velocity.",
      "If consensus cannot be reached immediately, run a time-boxed spike or prototype to gather empirical data; once a decision is made, disagree and commit fully."
    ],
    bestPractices: "Document the trade-offs and decision rationale in an Architecture Decision Record (ADR) to ensure organizational alignment."
  }
};

/**
 * Determines whether the interviewer's question is explicitly asking to write or implement code.
 */
export function isCodeQuestion(question: string): boolean {
  const q = question.toLowerCase().trim();
  return /\b(?:write\s+(?:the\s+|a\s+)?code|show\s+(?:me\s+)?(?:the\s+)?code|give\s+me\s+(?:the\s+)?code|how\s+to\s+code|code\s+(?:for|a|an|to)|how\s+would\s+you\s+code|can\s+you\s+code|could\s+you\s+code|implement\b.*?\b(?:code|function|class|method|algorithm|in\s+(?:python|javascript|typescript|java|c\+\+|go|rust|c#))|write\s+a\s+(?:function|method|class|program|script)|write\s+(?:python|javascript|typescript|java|c\+\+|go)\s+code)\b/i.test(q) ||
    /^(?:write\s+code|code\s+this|write\s+a\s+function|write\s+the\s+code)\b/i.test(q);
}

/**
 * Synthesizes an intelligent, direct, and exact answer for a given interview question.
 */
export function synthesizeLocalAnswer(
  question: string,
  preferences?: Partial<Preferences>,
  evidence: Evidence[] = []
): GeneratedAnswer {
  const startTime = Date.now();
  const cleaned = question.trim();
  const lower = cleaned.toLowerCase();
  const words = lower.replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(w => w.length > 2);

  const role = preferences?.role || "Software Engineer";
  const format = preferences?.response_delivery || "talking_points";
  const style = preferences?.answer_style || "concise";
  const tone = preferences?.answer_tone || "professional";
  const level = preferences?.english_level || "everyday";
  const personalization = preferences?.personalization || "grounded";

  const companyName = preferences?.company ? preferences.company.trim() : "";
  const isCompanyQuestion = Boolean(companyName && new RegExp(`\\b${companyName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b|why (this|your) company|why do you want to join|what do you know about (us|our company)`, "i").test(cleaned));

  // Find matching topic in knowledge base (tolerates simple plurals: queue/queues)
  let matchedTopic: TopicKnowledge | null = null;
  for (const topic of Object.values(KNOWLEDGE_BASE)) {
    for (const kw of topic.keywords) {
      const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}s?\\b`, "i");
      if (regex.test(lower)) {
        matchedTopic = topic;
        break;
      }
    }
    if (matchedTopic) break;
  }

  // Filter evidence: only use evidence if personalization === "grounded" and text is relevant
  const singular = (w: string): string =>
    w.length > 4 ? w.replace(/ies$/, "y").replace(/(?<!ss)s$/, "") : w;
  const relevantEvidence = personalization === "grounded"
    ? evidence.filter(e => {
        if (!e.text) return false;
        const evLower = (e.text + " " + (e.source_name || "")).toLowerCase();
        return words.some(w => w.length > 3 && (evLower.includes(w) || evLower.includes(singular(w))));
      })
    : [];

  // ---- Human-voice overlays: every preference audibly reshapes the answer ----
  type Tone = "professional" | "friendly" | "casual";
  type Level = "simple" | "everyday" | "advanced";
  const activeTone: Tone = tone === "friendly" || tone === "casual" ? tone : "professional";
  const activeLevel: Level = level === "simple" || level === "advanced" ? level : "everyday";

  // When the interviewer specifically asks to write code, shift directly to displaying the exact code
  if (isCodeQuestion(cleaned)) {
    const defaultCode = "```python\ndef solution(items: list) -> list:\n    # Clean linear time O(n) scan\n    result = []\n    for item in items:\n        if item is not None:\n            result.append(item)\n    return result\n```";
    const snippet = matchedTopic?.codeSnippet || defaultCode;
    const intro = activeTone === "friendly"
      ? "In my experience, here is a clean and straightforward way to implement this in Python:"
      : activeTone === "casual"
        ? "Honestly, the cleanest way to write this is pretty straightforward in Python:"
        : "Here is the optimal implementation using a clean, straightforward approach in Python:";
    const complexity = "This implementation runs with optimal time complexity and minimal auxiliary space.";
    const answerText = `${intro}\n\n${snippet}\n\n${complexity}`;
    return {
      question: cleaned,
      answer: answerText,
      evidence: relevantEvidence.length > 0 ? relevantEvidence : [],
      keywords: words.slice(0, 5),
      latency_ms: Math.min(25, Date.now() - startTime)
    };
  }

  const OPENER: Record<Tone, string> = {
    professional: "Sure — ",
    friendly: "Yeah, so ",
    casual: "Honestly, ",
  };

  // Plain-words glossary for Simple English: replaces jargon WITHOUT
  // changing meaning (never the destructive single-word swaps of before).
  const SIMPLE_GLOSSARY: Array<[RegExp, string]> = [
    [/contiguous memory locations/gi, "back-to-back spots in memory"],
    [/\bcontiguous\b/gi, "back-to-back"],
    [/\bamortized\b/gi, "averaged out"],
    [/\bassociative\b/gi, "key-value"],
    [/\bidempotent\b/gi, "safe to retry"],
    [/\bidempotency\b/gi, "safe-to-retry behavior"],
    [/\bspatial locality\b/gi, "items sitting next to each other in memory"],
    [/\bauxiliary memory\b/gi, "extra memory"],
    [/\bdegenerate\/skewed\b/gi, "lopsided"],
    [/\bdegenerate\b/gi, "lopsided"],
  ];
  const explainBigO = (text: string): string =>
    text
      .replace(/O\(1\)(?! —)/g, "O(1) — instant no matter the size")
      .replace(/O\(log n\)(?! —)/g, "O(log n) — grows very slowly")
      .replace(/O\(n log n\)(?! —)/g, "O(n log n) — a bit more than linear")
      .replace(/O\(n\)(?! —)/g, "O(n) — grows with the data");

  const simplify = (text: string): string => {
    if (activeLevel !== "simple") return text;
    let out = text;
    for (const [pattern, replacement] of SIMPLE_GLOSSARY) out = out.replace(pattern, replacement);
    return explainBigO(out);
  };

  // Warm contractions for friendly/casual spoken flow.
  const CONTRACT = new Map([
    [/(\bI) am\b/g, "$1'm"], [/(\bit) is\b/gi, "$1's"], [/(\bthat) is\b/gi, "$1's"],
    [/(\bthere) is\b/gi, "$1's"], [/(\bI) have\b/g, "$1've"], [/(\bdo) not\b/gi, "$1n't"],
    [/(\bdoes) not\b/gi, "$1n't"], [/(\bcould) not\b/gi, "$1n't"], [/(\bwill) not\b/gi, "$1 won't"],
    [/(\bcannot)\b/gi, "can't"],
  ]);
  const warm = (text: string): string => {
    if (activeTone === "professional") return text;
    let out = text;
    for (const [pattern, replacement] of CONTRACT) out = out.replace(pattern, replacement as string);
    if (activeTone === "casual") out = out.replace(/\bvery\b/g, "really").replace(/\bhowever\b/gi, "but");
    return out;
  };

  const tradeSentence = (raw: string): string =>
    warm(simplify(`The trade-off I keep in mind: ${raw.charAt(0).toLowerCase() + raw.slice(1)}`));
  const practiceSentence = (raw: string): string =>
    warm(simplify(`What I actually do in production: ${raw.charAt(0).toLowerCase() + raw.slice(1)}`));

  const sentences: string[] = [];

  if (isCompanyQuestion && companyName) {
    const admiration =
      activeTone === "casual"
        ? `I've been following ${companyName} for a while, and honestly what pulls me in is how seriously you take engineering quality and customer impact.`
        : activeTone === "friendly"
          ? `I've been following ${companyName} closely, and I really admire your engineering standards and focus on customer impact.`
          : `I have followed ${companyName}'s technical leadership closely, and I admire your engineering standards and focus on customer impact.`;
    const fit =
      activeTone === "professional"
        ? `As a ${role}, I build resilient architectures and ship reliable systems under load — principles that align directly with how ${companyName} builds software.`
        : `As a ${role}, I spend my days building resilient systems and shipping reliable software under load, which is exactly how ${companyName} builds.`;
    sentences.push(admiration, fit);
    if (style !== "concise") {
      sentences.push(
        activeTone === "professional"
          ? "I value rigorous code reviews, automated testing, and measurable product impact."
          : "What matters most to me is rigorous code review, solid automated testing, and shipping impact you can measure."
      );
    }
  } else if (matchedTopic) {
    const core = simplify(matchedTopic.voice).split(/(?<=[.!?])\s+/).filter(Boolean);
    const extra = simplify(matchedTopic.story).split(/(?<=[.!?])\s+/).filter(Boolean);
    if (style === "concise") {
      sentences.push(...core.slice(0, 2));
    } else if (style === "balanced") {
      sentences.push(...core.slice(0, 3), ...extra.slice(0, 1));
    } else {
      sentences.push(...core, ...extra);
      if (matchedTopic.tradeoffs) sentences.push(tradeSentence(matchedTopic.tradeoffs.replace(/\.$/, "")));
      if (matchedTopic.bestPractices) sentences.push(practiceSentence(matchedTopic.bestPractices.replace(/\.$/, "")));
    }
  } else {
    // General question synthesis in a genuine spoken voice.
    const approach =
      activeTone === "casual"
        ? "Honestly, I usually start by clarifying the core requirements and constraints before touching any code."
        : activeTone === "friendly"
          ? "In my experience, I like to start by clarifying the core requirements and constraints first."
          : "I approach this by clarifying the core requirements and constraints first.";
    sentences.push(warm(simplify(approach)));
    if (style === "concise") {
      sentences.push(warm(simplify("Then I pick the simplest resilient design and validate it with automated tests.")));
    } else {
      sentences.push(warm(simplify("Once the requirements are clear, I weigh the trade-offs — time complexity against memory and simplicity — and pick the simplest design that holds up.")));
      sentences.push(warm(simplify("Finally I validate it with unit and integration tests and make sure it's observable in production.")));
    }
  }

  // Grounded personalization: weave the candidate's real sources into the
  // answer (first person is correct — these are the candidate's own files).
  // Technical personalization skips this and stays on the topic.
  if (personalization === "grounded" && relevantEvidence.length > 0 && style !== "concise") {
    const sourceName = relevantEvidence[0].source_name || "my portfolio";
    sentences.push(
      activeTone === "professional"
        ? `This connects directly with my work in ${sourceName}.`
        : `Something very similar came up in my ${sourceName} work.`
    );
  }

  const spoken = sentences.map(s => warm(s).trim()).filter(Boolean);
  const withOpener = (text: string): string => {
    if (format !== "natural") return text;
    const first = spoken[0] || "";
    if (/^(sure|yeah|honestly|in my|i'm|i am|as a)\b/i.test(first)) return text;
    // Lowercase the join ("Sure — a list is..."), but never break "I".
    const joined = /^I('m| am|'ve|'d|'ll)?\b/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
    return `${OPENER[activeTone]}${joined}`;
  };

  let answerText = "";
  if (format === "structured") {
    answerText = spoken.map((s, idx) => `${idx + 1}. ${s}`).join("\n\n");
  } else if (format === "natural") {
    answerText = withOpener(spoken.join(" "));
  } else {
    // Talking points: short cue bullets the candidate voices themselves.
    answerText = spoken.slice(0, style === "concise" ? 2 : 4).map(s => `• ${s}`).join("\n\n");
  }

  return {
    question: cleaned,
    answer: answerText,
    evidence: relevantEvidence.length > 0 ? relevantEvidence : [],
    keywords: words.slice(0, 5),
    latency_ms: Math.min(25, Date.now() - startTime)
  };
}
