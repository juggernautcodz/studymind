import type { NotesSection, Flashcard, QuizQuestion } from "@/types";

const SAMPLE_TRANSCRIPT_SEGMENTS = [
  "Welcome to today's lecture on data structures. We'll be covering the fundamental concepts that form the backbone of computer science.",
  "First, let's discuss arrays. An array is a collection of elements stored at contiguous memory locations. The idea is to store multiple items of the same type together.",
  "Arrays have a fixed size, which means you need to know the number of elements in advance. This can be both an advantage and a limitation.",
  "Next, we'll look at linked lists. Unlike arrays, linked lists consist of nodes where each node contains data and a reference to the next node.",
  "The key advantage of linked lists is dynamic size allocation. You can easily add or remove elements without reallocating the entire structure.",
  "However, linked lists have some drawbacks. Random access is not possible - you must traverse from the head to reach any element.",
  "Now let's compare time complexities. Array access is O(1), while linked list access is O(n). But insertion at the beginning is O(n) for arrays and O(1) for linked lists.",
  "Moving on to stacks and queues. A stack follows Last-In-First-Out principle, like a stack of plates. A queue follows First-In-First-Out, like a line at a store.",
  "Stacks are used in function call management, expression evaluation, and backtracking algorithms. Queues are essential for breadth-first search and task scheduling.",
  "Finally, let's touch on trees. A tree is a hierarchical data structure with a root node and child nodes. Binary trees have at most two children per node.",
];

export function generateMockTranscript(): {
  text: string;
  timestamps: { start: number; end: number; text: string }[];
} {
  const numSegments = 5 + Math.floor(Math.random() * 5);
  const selectedSegments = SAMPLE_TRANSCRIPT_SEGMENTS.slice(0, numSegments);

  let currentTime = 0;
  const timestamps = selectedSegments.map((text) => {
    const duration = 10 + Math.random() * 20;
    const segment = {
      start: currentTime,
      end: currentTime + duration,
      text,
    };
    currentTime += duration;
    return segment;
  });

  return {
    text: selectedSegments.join(" "),
    timestamps,
  };
}

export function generateMockNotes(transcript: string): {
  title: string;
  sections: NotesSection[];
} {
  return {
    title: "Lecture Notes: Data Structures Fundamentals",
    sections: [
      {
        heading: "Introduction to Data Structures",
        bullets: [
          "Data structures form the backbone of computer science",
          "They organize and store data efficiently",
          "Choice of data structure affects algorithm performance",
        ],
      },
      {
        heading: "Arrays",
        bullets: [
          "Collection of elements at contiguous memory locations",
          "Fixed size - must know number of elements in advance",
          "O(1) random access time",
          "O(n) insertion/deletion in the middle",
        ],
      },
      {
        heading: "Linked Lists",
        bullets: [
          "Nodes containing data and reference to next node",
          "Dynamic size allocation",
          "O(1) insertion at beginning",
          "O(n) access time - must traverse from head",
        ],
      },
      {
        heading: "Stacks and Queues",
        bullets: [
          "Stack: LIFO (Last-In-First-Out) principle",
          "Queue: FIFO (First-In-First-Out) principle",
          "Stacks used for function calls, expression evaluation",
          "Queues used for BFS, task scheduling",
        ],
      },
      {
        heading: "Trees",
        bullets: [
          "Hierarchical structure with root and child nodes",
          "Binary trees have at most two children per node",
          "Used for searching, sorting, and hierarchical data",
        ],
      },
    ],
  };
}

export function generateMockFlashcards(): Omit<
  Flashcard,
  "id" | "topicId"
>[] {
  return [
    {
      question:
        "What is the time complexity of accessing an element in an array?",
      answer:
        "O(1) - constant time, because arrays provide direct access via index.",
      orderIndex: 0,
    },
    {
      question: "What is the main advantage of linked lists over arrays?",
      answer:
        "Dynamic size allocation - you can add or remove elements without reallocating the entire structure.",
      orderIndex: 1,
    },
    {
      question: "What principle does a Stack follow?",
      answer:
        "LIFO - Last-In-First-Out. The last element added is the first one to be removed.",
      orderIndex: 2,
    },
    {
      question: "What principle does a Queue follow?",
      answer:
        "FIFO - First-In-First-Out. The first element added is the first one to be removed.",
      orderIndex: 3,
    },
    {
      question:
        "What is the time complexity of inserting at the beginning of a linked list?",
      answer:
        "O(1) - constant time, because you only need to update the head pointer.",
      orderIndex: 4,
    },
    {
      question: "Name two common uses for stacks.",
      answer:
        "Function call management (call stack) and expression evaluation (parsing).",
      orderIndex: 5,
    },
    {
      question: "What is a binary tree?",
      answer:
        "A tree data structure where each node has at most two children, typically called left and right.",
      orderIndex: 6,
    },
    {
      question: "Why is random access not possible in linked lists?",
      answer:
        "Because elements are not stored contiguously - you must traverse from the head to reach any element.",
      orderIndex: 7,
    },
    {
      question:
        "What is the time complexity of insertion in the middle of an array?",
      answer:
        "O(n) - because you need to shift all subsequent elements to make room.",
      orderIndex: 8,
    },
    {
      question: "Name a common use case for queues.",
      answer:
        "Breadth-First Search (BFS) in graphs and task scheduling in operating systems.",
      orderIndex: 9,
    },
  ];
}

export function generateMockQuiz(): Omit<
  QuizQuestion,
  "id" | "quizId" | "orderIndex"
>[] {
  return [
    {
      question:
        "What is the time complexity of accessing an element by index in an array?",
      options: ["O(1)", "O(n)", "O(log n)", "O(n^2)"],
      correctIndex: 0,
    },
    {
      question: "Which data structure follows the LIFO principle?",
      options: ["Queue", "Array", "Stack", "Linked List"],
      correctIndex: 2,
    },
    {
      question:
        "What is the main disadvantage of arrays compared to linked lists?",
      options: [
        "Slower access time",
        "Fixed size",
        "More memory usage",
        "Cannot store primitives",
      ],
      correctIndex: 1,
    },
    {
      question:
        "In a binary tree, what is the maximum number of children each node can have?",
      options: ["1", "2", "3", "Unlimited"],
      correctIndex: 1,
    },
    {
      question:
        "Which operation is more efficient in a linked list compared to an array?",
      options: [
        "Random access",
        "Insertion at beginning",
        "Binary search",
        "Memory usage",
      ],
      correctIndex: 1,
    },
  ];
}

export function generateMockOCR(imagePath: string): string {
  const sampleTexts = [
    "Binary Search Tree (BST)\n- Left subtree < root\n- Right subtree > root\n- O(log n) search, insert, delete (balanced)\n\nAVL Trees\n- Self-balancing BST\n- Height difference <= 1\n- Rotations: LL, RR, LR, RL",
    "Hash Tables\n- Key-value pairs\n- O(1) average lookup\n- Collision handling:\n  * Chaining\n  * Open addressing\n- Load factor = n/m",
    "Graph Representations\n1. Adjacency Matrix\n   - Space: O(V^2)\n   - Edge lookup: O(1)\n\n2. Adjacency List\n   - Space: O(V+E)\n   - Edge lookup: O(degree)",
    "Sorting Algorithms Comparison\n\nQuick Sort: O(n log n) avg\nMerge Sort: O(n log n) guaranteed\nHeap Sort: O(n log n) in-place\nBubble Sort: O(n^2) simple",
  ];

  return sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
}

export function generateMockMindmapNodes(courseName: string, topics: string[]) {
  const nodes: {
    title: string;
    nodeType: "course" | "topic" | "concept";
    depth: number;
  }[] = [{ title: courseName, nodeType: "course", depth: 0 }];

  topics.forEach((topic) => {
    nodes.push({ title: topic, nodeType: "topic", depth: 1 });
  });

  const concepts = [
    "Key Concepts",
    "Definitions",
    "Examples",
    "Practice Problems",
    "Review Notes",
  ];

  concepts.slice(0, 3).forEach((concept) => {
    nodes.push({ title: concept, nodeType: "concept", depth: 2 });
  });

  return nodes;
}
