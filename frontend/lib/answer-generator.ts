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
  keyPoints: string[];
  tradeoffs?: string;
  codeSnippet?: string;
  bestPractices: string;
}

const KNOWLEDGE_BASE: Record<string, TopicKnowledge> = {
  list: {
    keywords: ["list", "lists", "arraylist", "dynamic array", "linked list"],
    title: "List Data Structure",
    definition: "A list is an ordered, mutable linear data structure that stores an indexed sequence of elements, allowing duplicate values and element access by position.",
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
    keyPoints: [
      "QuickSort: Divide-and-conquer using a pivot element. Average time O(n log n), worst-case O(n^2), space O(log n) in-place. Extremely fast in practice due to cache friendliness.",
      "MergeSort: Divide-and-conquer dividing array in halves, sorting recursively, and merging. Guaranteed O(n log n) time, stable, requires O(n) auxiliary memory.",
      "TimSort (used in Python and Java): Hybrid of MergeSort and InsertionSort designed for real-world data with existing ordered runs, O(n log n) worst and O(n) best case."
    ],
    bestPractices: "Choose QuickSort for memory-constrained in-place sorting; choose MergeSort/TimSort when stability and deterministic O(n log n) runtime are required."
  },
  react: {
    keywords: ["react", "virtual dom", "reactjs", "jsx", "reconciliation"],
    title: "React & Virtual DOM Architecture",
    definition: "React is a component-based, declarative JavaScript library for building user interfaces with unidirectional data flow and efficient DOM updates.",
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
    keyPoints: [
      "Start by assuming positive intent and listening carefully to understand the opposing perspective's underlying constraints and priorities.",
      "Depersonalize the debate by framing the problem around measurable criteria: performance benchmarks, operational complexity, security, and developer velocity.",
      "If consensus cannot be reached immediately, run a time-boxed spike or prototype to gather empirical data; once a decision is made, disagree and commit fully."
    ],
    bestPractices: "Document the trade-offs and decision rationale in an Architecture Decision Record (ADR) to ensure organizational alignment."
  }
};

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

  // Find matching topic in knowledge base
  let matchedTopic: TopicKnowledge | null = null;
  for (const topic of Object.values(KNOWLEDGE_BASE)) {
    for (const kw of topic.keywords) {
      const regex = new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
      if (regex.test(lower)) {
        matchedTopic = topic;
        break;
      }
    }
    if (matchedTopic) break;
  }

  // Filter evidence: only use evidence if personalization === "grounded" and text is relevant
  const relevantEvidence = personalization === "grounded"
    ? evidence.filter(e => {
        if (!e.text) return false;
        const evLower = (e.text + " " + (e.source_name || "")).toLowerCase();
        return words.some(w => w.length > 3 && evLower.includes(w));
      })
    : [];

  let answerText = "";

  if (isCompanyQuestion && companyName) {
    if (format === "structured") {
      answerText = `1. Engineering Impact: ${companyName}'s focus on scalable architecture and reliability deeply aligns with my engineering background.\n\n` +
        `2. Technical Alignment: My experience as a ${role} building resilient systems and managing distributed latency positions me to contribute immediately.\n\n` +
        `3. Long-Term Value: I value high engineering rigor, clear code reviews, and delivering measurable product impact.`;
    } else if (format === "natural") {
      answerText = `I have followed ${companyName}'s technical leadership closely, and I am especially excited by your scale, high engineering standards, and focus on customer impact. In my work as a ${role}, I prioritize building resilient architectures and shipping reliable systems under load—principles that directly align with how ${companyName} builds software.`;
    } else {
      answerText = `• Scalable Architecture: Strong technical admiration for ${companyName}'s engineering infrastructure and product velocity.\n\n` +
        `• Proven Experience: Solid background as a ${role} designing resilient systems that solve complex, high-throughput challenges.\n\n` +
        `• Engineering Rigor: Committed to clean code reviews, automated testing, and continuous operational excellence.`;
    }
  } else if (matchedTopic) {
    let keyPoints = matchedTopic.keyPoints;
    if (style === "concise") {
      keyPoints = keyPoints.slice(0, 2);
    }
    if (level === "simple") {
      keyPoints = keyPoints.map(kp => kp.replace(/amortized|reconciliation|unidirectional|idempotency/gi, "consistent"));
    }

    if (format === "structured") {
      answerText = `1. ${matchedTopic.definition}\n\n` +
        keyPoints.map((kp, idx) => `${idx + 2}. ${kp}`).join("\n\n") +
        (matchedTopic.tradeoffs && style !== "concise" ? `\n\n${keyPoints.length + 2}. ${matchedTopic.tradeoffs}` : "");
    } else if (format === "natural") {
      const pointsText = keyPoints.join(" ");
      const tradeoffText = matchedTopic.tradeoffs && style !== "concise" ? ` ${matchedTopic.tradeoffs}` : "";
      const bestPracticeText = matchedTopic.bestPractices ? ` In production, ${matchedTopic.bestPractices.charAt(0).toLowerCase() + matchedTopic.bestPractices.slice(1)}` : "";
      answerText = `${matchedTopic.definition} ${pointsText}${tradeoffText}${bestPracticeText}`.trim();
    } else {
      // Default: talking_points
      answerText = [
        `• ${matchedTopic.definition}`,
        ...keyPoints.map(kp => `• ${kp}`),
        ...(matchedTopic.tradeoffs && style !== "concise" ? [`• ${matchedTopic.tradeoffs}`] : []),
        ...(matchedTopic.bestPractices ? [`• Practical Application: ${matchedTopic.bestPractices}`] : [])
      ].join("\n\n");
    }
  } else {
    // General question synthesis
    if (format === "structured") {
      answerText = `1. Clarify Constraints: Identify core requirements, expected inputs, and edge cases before implementing.\n\n` +
        `2. Architectural Trade-offs: Balance time complexity, memory overhead, and maintainability to pick the right pattern.\n\n` +
        `3. Production Reliability: Build with thorough automated tests, graceful error handling, and end-to-end observability.`;
    } else if (format === "natural") {
      answerText = `I approach this by first clarifying the system constraints and expected inputs before jumping into implementation. Once the requirements are clear, I evaluate key technical trade-offs—such as time complexity versus memory footprint—and select the simplest, most resilient design. Finally, I validate correctness with comprehensive unit and integration tests and ensure proper observability in production.`;
    } else {
      // talking_points
      answerText = `• Core Requirements: Clarify inputs, performance constraints, and edge cases before implementation.\n\n` +
        `• Technical Trade-offs: Balance algorithmic time complexity, memory overhead, and architectural simplicity.\n\n` +
        `• Production Reliability: Ensure automated test coverage, robust error handling, and active monitoring.`;
    }
  }

  // Adjust tone if casual/friendly
  if (tone === "casual") {
    answerText = answerText.replace(/In my work as a [^:]+:\s*/i, "").trim();
  }

  return {
    question: cleaned,
    answer: answerText,
    evidence: relevantEvidence.length > 0 ? relevantEvidence : [],
    keywords: words.slice(0, 5),
    latency_ms: Math.min(25, Date.now() - startTime)
  };
}
