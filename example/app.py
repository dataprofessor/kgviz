"""
kgviz demo — Knowledge Graph use cases for text & article data.

Tabs:
  1. Concept Map      — single article, sections + concepts, co-occurrence edges
  2. Document Network — multi-paper similarity graph (simulated UMAP layout)
  3. Entity Network   — named entities with typed relationships
  4. Citation DAG     — directed citation graph of landmark AI papers
  5. Topic Explorer   — 40-document corpus laid out in 3-D embedding space
  6. Live Analysis    — paste your own text → instant concept graph (no deps)
"""

import math
import random
import re
from collections import Counter
from itertools import combinations

import streamlit as st

st.set_page_config(page_title="kgviz Demo", layout="wide")
st.title("kgviz — Knowledge Graph Demo")

from kgviz import kgviz  # noqa: E402

tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs([
    "Concept Map",
    "Document Network",
    "Entity Network",
    "Citation DAG",
    "Topic Explorer",
    "Live Analysis",
    "Embedding Map",
])


# ─────────────────────────────────────────────────────────────────────────────
# TAB 1 — Article Concept Map
#
# A single survey article ("Building Knowledge Graphs with LLMs") is broken
# into 8 sections. Each section contributes 4–6 key concepts. Two concepts
# are connected when they co-occur in the same section. Concepts that appear
# across multiple sections become large hub nodes that bridge the clusters.
#
# Real-world pipeline: split article → KeyBERT/TF-IDF per section →
#   build adjacency from section membership.
# ─────────────────────────────────────────────────────────────────────────────
def make_concept_map():
    SEC_COLOR = {
        "Introduction":             "#F8766D",
        "Knowledge Representation": "#E68613",
        "Language Models":          "#0CB702",
        "Info Extraction":          "#00C19A",
        "KG Integration":           "#00BFC4",
        "RAG & Retrieval":          "#00A9FF",
        "Applications":             "#C77CFF",
        "Evaluation":               "#FF68A1",
    }

    # Section → primary concepts
    SEC_CONCEPTS: dict[str, list[str]] = {
        "Introduction":             ["LLM", "knowledge graph", "structured data", "NLP", "reasoning", "survey"],
        "Knowledge Representation": ["entity", "relation", "triple", "ontology", "RDF", "SPARQL"],
        "Language Models":          ["transformer", "attention", "BERT", "GPT", "pretraining", "embedding"],
        "Info Extraction":          ["NER", "relation extraction", "coreference", "open IE", "span", "IE pipeline"],
        "KG Integration":           ["entity linking", "alignment", "disambiguation", "Wikidata", "DBpedia", "fusion"],
        "RAG & Retrieval":          ["RAG", "dense retrieval", "vector DB", "FAISS", "top-k", "context window"],
        "Applications":             ["question answering", "fact checking", "summarization", "dialog", "recommendation"],
        "Evaluation":               ["benchmark", "precision", "recall", "F1", "KGQA", "FewRel"],
    }

    # Concepts that span multiple sections → become hub nodes
    MULTI: dict[str, list[str]] = {
        "LLM":            ["Introduction", "Language Models", "RAG & Retrieval", "Applications"],
        "embedding":      ["Language Models", "RAG & Retrieval"],
        "reasoning":      ["Introduction", "Applications", "Evaluation"],
        "entity":         ["Knowledge Representation", "Info Extraction", "KG Integration"],
        "knowledge graph":["Introduction", "Knowledge Representation", "KG Integration", "Applications"],
        "retrieval":      ["RAG & Retrieval", "Applications"],
        "fine-tuning":    ["Language Models", "Info Extraction"],
    }

    # concept → set of sections it appears in
    c2s: dict[str, set[str]] = {}
    for sec, concepts in SEC_CONCEPTS.items():
        for c in concepts:
            c2s.setdefault(c, set()).add(sec)
    for c, secs in MULTI.items():
        c2s.setdefault(c, set()).update(secs)

    def primary_sec(c: str) -> str:
        for sec, concepts in SEC_CONCEPTS.items():
            if c in concepts:
                return sec
        return next(iter(c2s[c]))

    nodes = []
    for c, secs in c2s.items():
        psec = primary_sec(c)
        nodes.append({
            "id": c, "label": c,
            "color": SEC_COLOR[psec],
            "size": 2 + len(secs) * 3,
            "section": psec,
            "n_sections": len(secs),
        })

    # edges: every pair of concepts sharing at least one section
    sec2c: dict[str, set[str]] = {}
    for c, secs in c2s.items():
        for s in secs:
            sec2c.setdefault(s, set()).add(c)

    seen: set[tuple] = set()
    edges = []
    for concepts in sec2c.values():
        for a, b in combinations(sorted(concepts), 2):
            key = (min(a, b), max(a, b))
            if key not in seen:
                seen.add(key)
                edges.append({"source": a, "target": b})

    return nodes, edges


with tab1:
    st.subheader("Article Concept Map")
    st.caption(
        "Survey article: *Building Knowledge Graphs with Large Language Models*.  "
        "Concepts from the same section are connected. Cross-section hub concepts "
        "(larger nodes) tie the clusters together."
    )
    n1, e1 = make_concept_map()
    kgviz(
        nodes=n1, edges=e1,
        show_labels=True, label_outline=True,
        grain_density="light",
        warmup_ticks=80,
        key="concept_map",
    )
    with st.expander("Real-world pipeline"):
        st.markdown("""
**To apply to any article:**
```python
from keybert import KeyBERT
kw_model = KeyBERT()

for section_text in article_sections:
    keywords = kw_model.extract_keywords(section_text, top_n=6)
    # → two keywords in the same section → edge
    # → keyword in N sections → node size ∝ N
```
Hub concepts (appearing in many sections) naturally emerge as large connector nodes.
        """)


# ─────────────────────────────────────────────────────────────────────────────
# TAB 2 — Document Similarity Network
#
# 24 AI/ML papers across 4 research clusters, positioned using simulated UMAP
# coordinates. Edges connect papers above a cosine-similarity threshold (here
# approximated by cluster membership + Gaussian spread).
#
# Real-world pipeline: sentence-transformers → UMAP 3D → cosine sim edges.
# ─────────────────────────────────────────────────────────────────────────────
def make_doc_network():
    rng = random.Random(99)

    CLUSTERS = {
        "Transformers & Attention": {
            "color": "#ff0000", "center": (-70, 60, 20),
            "papers": [
                "Attention Is All You Need (2017)",
                "BERT: Pre-training Deep Bidirectional Transformers (2019)",
                "Exploring Limits of Transfer Learning with T5 (2020)",
                "An Image is Worth 16x16 Words — ViT (2021)",
                "FlashAttention: Fast Memory-Efficient Attention (2022)",
                "Mistral 7B (2023)",
            ],
        },
        "Large Language Models": {
            "color": "#00ffff", "center": (65, 65, -30),
            "papers": [
                "Language Models are Few-Shot Learners — GPT-3 (2020)",
                "Training Language Models to Follow Instructions (2022)",
                "LLaMA: Open & Efficient Foundation Models (2023)",
                "Constitutional AI: Harmlessness from AI Feedback (2022)",
                "Chain-of-Thought Prompting Elicits Reasoning (2022)",
                "Sparks of Artificial General Intelligence — GPT-4 (2023)",
            ],
        },
        "Knowledge & Retrieval": {
            "color": "#00ff99", "center": (-55, -65, -45),
            "papers": [
                "Retrieval-Augmented Generation for NLP — RAG (2020)",
                "Dense Passage Retrieval — DPR (2020)",
                "WebGPT: Browser-Assisted Question Answering (2022)",
                "Toolformer: Language Models Teach Themselves (2023)",
                "Self-RAG: Learning to Retrieve, Generate & Critique (2023)",
                "GraphRAG: From Local to Global Summarization (2024)",
            ],
        },
        "Knowledge Graphs": {
            "color": "#cc00ff", "center": (55, -55, 55),
            "papers": [
                "Knowledge Graph Embedding by Translating on Hyperplanes (2014)",
                "RotatE: KG Embedding by Relational Rotation (2019)",
                "ERNIE: Enhanced Language Representation with KG (2019)",
                "KGPT: Knowledge-Grounded Pre-Training (2020)",
                "UniKGQA: Unified Retrieval & Reasoning over KGs (2022)",
                "Think-on-Graph: Deep & Responsible LLM-KG Reasoning (2024)",
            ],
        },
    }

    nodes = []
    for cluster, info in CLUSTERS.items():
        cx, cy, cz = info["center"]
        for title in info["papers"]:
            nodes.append({
                "id": title,
                "label": title[:38] + ("…" if len(title) > 38 else ""),
                "color": info["color"],
                "size": rng.randint(3, 8),
                "x": cx + rng.gauss(0, 25),
                "y": cy + rng.gauss(0, 25),
                "z": cz + rng.gauss(0, 25),
                "cluster": cluster,
            })

    # Intra-cluster edges (~55% of all pairs)
    cluster_papers: dict[str, list[str]] = {
        c: list(info["papers"]) for c, info in CLUSTERS.items()
    }
    seen: set[tuple] = set()
    edges = []
    for papers in cluster_papers.values():
        for a, b in combinations(papers, 2):
            if rng.random() < 0.55:
                key = (min(a, b), max(a, b))
                if key not in seen:
                    seen.add(key)
                    edges.append({"source": a, "target": b})

    # Cross-cluster bridge edges (semantic overlaps)
    bridges = [
        ("Attention Is All You Need (2017)",
         "ERNIE: Enhanced Language Representation with KG (2019)"),
        ("Language Models are Few-Shot Learners — GPT-3 (2020)",
         "GraphRAG: From Local to Global Summarization (2024)"),
        ("Retrieval-Augmented Generation for NLP — RAG (2020)",
         "UniKGQA: Unified Retrieval & Reasoning over KGs (2022)"),
        ("LLaMA: Open & Efficient Foundation Models (2023)",
         "Self-RAG: Learning to Retrieve, Generate & Critique (2023)"),
        ("Dense Passage Retrieval — DPR (2020)",
         "Knowledge Graph Embedding by Translating on Hyperplanes (2014)"),
        ("Chain-of-Thought Prompting Elicits Reasoning (2022)",
         "Think-on-Graph: Deep & Responsible LLM-KG Reasoning (2024)"),
    ]
    for a, b in bridges:
        key = (min(a, b), max(a, b))
        if key not in seen:
            seen.add(key)
            edges.append({"source": a, "target": b})

    return nodes, edges


with tab2:
    st.subheader("Document Similarity Network")
    st.caption(
        "24 AI/ML papers positioned by embedding similarity (simulated UMAP).  "
        "Edges link papers with cosine similarity above threshold; "
        "bridge edges connect genuinely cross-domain work."
    )
    n2, e2 = make_doc_network()
    kgviz(
        nodes=n2, edges=e2,
        use_coordinates=True,
        show_labels=True, label_outline=True,
        grain_density="light",
        key="doc_network",
    )
    with st.expander("Real-world pipeline"):
        st.markdown("""
```python
from sentence_transformers import SentenceTransformer
import umap, numpy as np
from sklearn.metrics.pairwise import cosine_similarity

model = SentenceTransformer("all-MiniLM-L6-v2")
embeddings = model.encode(abstracts)                          # (N, 384)
coords = umap.UMAP(n_components=3).fit_transform(embeddings) # (N, 3)
coords *= 100   # scale for visual spread

sim = cosine_similarity(embeddings)
edges = [
    {"source": titles[i], "target": titles[j]}
    for i, j in zip(*np.where(sim > 0.6)) if i < j
]
```
        """)


# ─────────────────────────────────────────────────────────────────────────────
# TAB 3 — Named Entity Network
#
# A heterogeneous knowledge graph extracted from an AI research corpus.
# Five entity types (Person, Organization, Paper, Concept, Dataset) with
# typed, directed relationship edges coloured by relation type.
#
# Real-world pipeline: spaCy NER + dependency parse → relation extraction.
# ─────────────────────────────────────────────────────────────────────────────
def make_entity_network():
    ETYPE: dict[str, tuple[str, int]] = {
        # type → (color, size)
        "Person":       ("#ff0066", 5),
        "Organization": ("#ff9900", 8),
        "Paper":        ("#0099ff", 5),
        "Concept":      ("#00ff99", 4),
        "Dataset":      ("#cc00ff", 4),
    }

    ENTITIES: list[tuple[str, str]] = [
        # People
        ("Vaswani et al.", "Person"), ("Devlin et al.", "Person"),
        ("Brown et al.", "Person"),   ("Lewis et al.", "Person"),
        ("Wei et al.", "Person"),     ("Ouyang et al.", "Person"),
        ("Touvron et al.", "Person"), ("Yao et al.", "Person"),
        # Organizations
        ("Google Brain", "Organization"), ("OpenAI", "Organization"),
        ("Meta AI", "Organization"),      ("DeepMind", "Organization"),
        ("Allen AI", "Organization"),     ("Hugging Face", "Organization"),
        # Papers / Models
        ("Transformer", "Paper"),    ("BERT", "Paper"),
        ("GPT-3", "Paper"),          ("RAG", "Paper"),
        ("LLaMA", "Paper"),          ("InstructGPT", "Paper"),
        ("ReAct", "Paper"),          ("GraphRAG", "Paper"),
        # Concepts
        ("attention mechanism", "Concept"), ("pretraining", "Concept"),
        ("RLHF", "Concept"),                ("chain-of-thought", "Concept"),
        ("retrieval augmentation", "Concept"), ("instruction tuning", "Concept"),
        ("few-shot learning", "Concept"),   ("knowledge graph", "Concept"),
        # Datasets
        ("SQuAD", "Dataset"),           ("Natural Questions", "Dataset"),
        ("MMLU", "Dataset"),            ("BIG-Bench", "Dataset"),
        ("The Pile", "Dataset"),
    ]

    nodes = []
    for name, etype in ENTITIES:
        _color, size = ETYPE[etype]
        nodes.append({"id": name, "label": name, "type": etype, "size": size})

    # Relation type → edge color
    REL_COLOR = {
        "AUTHORED":     "#ffd92f",
        "AFFILIATED":   "#66c2a5",
        "PROPOSES":     "#fc8d62",
        "USES":         "#8da0cb",
        "CITES":        "#e78ac3",
        "EVALUATES_ON": "#a6d854",
        "DEMONSTRATES": "#ffd92f",
        "BUILDS_ON":    "#b3b3b3",
    }

    RAW_EDGES = [
        # Authorship
        ("Vaswani et al.", "Transformer",          "AUTHORED"),
        ("Devlin et al.",  "BERT",                 "AUTHORED"),
        ("Brown et al.",   "GPT-3",                "AUTHORED"),
        ("Lewis et al.",   "RAG",                  "AUTHORED"),
        ("Touvron et al.", "LLaMA",                "AUTHORED"),
        ("Ouyang et al.",  "InstructGPT",          "AUTHORED"),
        ("Wei et al.",     "chain-of-thought",     "PROPOSES"),
        ("Yao et al.",     "ReAct",                "AUTHORED"),
        # Org affiliations
        ("Vaswani et al.", "Google Brain",         "AFFILIATED"),
        ("Devlin et al.",  "Google Brain",         "AFFILIATED"),
        ("Brown et al.",   "OpenAI",               "AFFILIATED"),
        ("Ouyang et al.",  "OpenAI",               "AFFILIATED"),
        ("Touvron et al.", "Meta AI",              "AFFILIATED"),
        ("Lewis et al.",   "Meta AI",              "AFFILIATED"),
        ("Yao et al.",     "Allen AI",             "AFFILIATED"),
        # Paper → concept
        ("Transformer",    "attention mechanism",  "PROPOSES"),
        ("BERT",           "pretraining",          "USES"),
        ("GPT-3",          "few-shot learning",    "DEMONSTRATES"),
        ("InstructGPT",    "RLHF",                 "USES"),
        ("LLaMA",          "instruction tuning",   "USES"),
        ("RAG",            "retrieval augmentation","PROPOSES"),
        ("RAG",            "knowledge graph",       "USES"),
        ("GraphRAG",       "knowledge graph",       "USES"),
        ("ReAct",          "chain-of-thought",      "BUILDS_ON"),
        # Citation chain
        ("BERT",           "Transformer",           "CITES"),
        ("GPT-3",          "Transformer",           "CITES"),
        ("RAG",            "BERT",                  "CITES"),
        ("InstructGPT",    "GPT-3",                 "CITES"),
        ("LLaMA",          "GPT-3",                 "CITES"),
        ("GraphRAG",       "RAG",                   "CITES"),
        # Evaluation datasets
        ("BERT",           "SQuAD",                 "EVALUATES_ON"),
        ("GPT-3",          "Natural Questions",      "EVALUATES_ON"),
        ("LLaMA",          "MMLU",                  "EVALUATES_ON"),
        ("InstructGPT",    "BIG-Bench",             "EVALUATES_ON"),
        ("RAG",            "Natural Questions",      "EVALUATES_ON"),
        ("LLaMA",          "The Pile",               "USES"),
    ]

    edges = [
        {
            "source": s,
            "target": t,
            "relation": rel,
            "label": rel,
            "weight": 2 if rel in ("CITES", "BUILDS_ON") else 1,
        }
        for s, t, rel in RAW_EDGES
    ]
    return nodes, edges, ETYPE, REL_COLOR


with tab3:
    st.subheader("Named Entity Network")
    st.caption(
        "Entities extracted from an AI research corpus.  "
        "Node colour = entity type; edge colour = relationship type."
    )
    n3, e3, ETYPE, REL_COLOR = make_entity_network()
    event = kgviz(
        nodes=n3,
        edges=e3,
        node_color_by="type",
        node_size_by="size",
        edge_color_by="relation",
        edge_width_by="weight",
        edge_label="label",
        show_edge_labels=True,
        show_legend=True,
        legend_node_by="type",
        legend_edge_by="relation",
        show_labels=True,
        label_outline=True,
        grain_density="light",
        warmup_ticks=100,
        key="entity_net",
    )
    if event and isinstance(event, dict):
        if event.get("type") == "selection_change":
            st.caption(f"Selected: {event.get('node_ids', [])} · Focus: {event.get('focus_id')}")
        elif event.get("type") == "node_click":
            with st.expander("Node inspector", expanded=False):
                st.json(event.get("node", {}))
    st.markdown(
        "**Tips:** double-click a node to focus its neighborhood · "
        "click legend items to filter types · search supports label and id"
    )
    rcols = st.columns(4)
    for col, (rel, color) in zip(rcols * 2, REL_COLOR.items()):
        col.markdown(
            f'<span style="display:inline-block;width:22px;height:3px;'
            f'background:{color};margin-right:5px;vertical-align:middle"></span>{rel}',
            unsafe_allow_html=True,
        )
    with st.expander("Real-world pipeline"):
        st.markdown("""
```python
import spacy
nlp = spacy.load("en_core_web_trf")

entities, relations = [], []
for doc_text in corpus:
    doc = nlp(doc_text)
    entities += [(ent.text, ent.label_) for ent in doc.ents]
    relations += extract_relations(doc)   # (head, relation, tail)

# Deduplicate + count co-occurrences for edge weights
```
        """)


# ─────────────────────────────────────────────────────────────────────────────
# TAB 4 — Citation DAG
#
# 18 landmark AI papers arranged as a directed acyclic graph.
# Edge A → B means "A cites B". dag_mode="td" places foundational papers
# at the root and newer papers descending from them.
# Node colour gradient: blue (old) → orange (recent).
#
# Real-world pipeline: Semantic Scholar API → citation edges.
# ─────────────────────────────────────────────────────────────────────────────
def make_citation_dag():
    # (id, display label, year, size)
    PAPERS = [
        ("word2vec",    "Word2Vec (2013)",                         2013, 5),
        ("transformer", "Attention Is All You Need (2017)",        2017, 10),
        ("bert",        "BERT (2019)",                             2019, 9),
        ("gpt2",        "GPT-2 (2019)",                           2019, 7),
        ("rag",         "RAG (2020)",                             2020, 8),
        ("gpt3",        "GPT-3 (2020)",                           2020, 9),
        ("dpr",         "DPR (2020)",                             2020, 6),
        ("t5",          "T5 (2020)",                              2020, 7),
        ("clip",        "CLIP (2021)",                            2021, 7),
        ("instructgpt", "InstructGPT (2022)",                     2022, 8),
        ("cot",         "Chain-of-Thought (2022)",                2022, 7),
        ("selfrag",     "Self-RAG (2023)",                        2023, 6),
        ("llama",       "LLaMA (2023)",                           2023, 8),
        ("react",       "ReAct (2023)",                           2023, 6),
        ("mistral",     "Mistral 7B (2023)",                      2023, 7),
        ("gpt4",        "GPT-4 (2023)",                           2023, 9),
        ("graphrag",    "GraphRAG (2024)",                        2024, 7),
        ("llama3",      "LLaMA 3 (2024)",                         2024, 8),
    ]

    yr_min, yr_max = 2013, 2024

    def year_color(yr: int) -> str:
        t = (yr - yr_min) / (yr_max - yr_min)
        r = int(66  + t * (255 - 66))
        g = int(133 + t * (127 - 133))
        b = int(244 - t * (244 - 14))
        return f"#{r:02x}{g:02x}{b:02x}"

    nodes = [
        {"id": pid, "label": label, "color": year_color(yr), "size": sz, "year": yr}
        for pid, label, yr, sz in PAPERS
    ]

    edges = [
        {"source": "bert",        "target": "transformer"},
        {"source": "bert",        "target": "word2vec"},
        {"source": "gpt2",        "target": "transformer"},
        {"source": "gpt2",        "target": "word2vec"},
        {"source": "t5",          "target": "bert"},
        {"source": "t5",          "target": "transformer"},
        {"source": "dpr",         "target": "bert"},
        {"source": "gpt3",        "target": "gpt2"},
        {"source": "gpt3",        "target": "transformer"},
        {"source": "rag",         "target": "bert"},
        {"source": "rag",         "target": "dpr"},
        {"source": "clip",        "target": "transformer"},
        {"source": "clip",        "target": "gpt2"},
        {"source": "instructgpt", "target": "gpt3"},
        {"source": "cot",         "target": "gpt3"},
        {"source": "react",       "target": "cot"},
        {"source": "react",       "target": "instructgpt"},
        {"source": "llama",       "target": "gpt3"},
        {"source": "llama",       "target": "t5"},
        {"source": "gpt4",        "target": "instructgpt"},
        {"source": "gpt4",        "target": "gpt3"},
        {"source": "selfrag",     "target": "rag"},
        {"source": "selfrag",     "target": "llama"},
        {"source": "mistral",     "target": "llama"},
        {"source": "graphrag",    "target": "rag"},
        {"source": "graphrag",    "target": "gpt4"},
        {"source": "llama3",      "target": "llama"},
        {"source": "llama3",      "target": "mistral"},
    ]
    return nodes, edges


with tab4:
    st.subheader("Citation DAG")
    st.caption(
        "Directed citation graph of 18 landmark AI papers (arrow = 'cites').  "
        "Colour gradient: blue = 2013 → orange = 2024.  "
        "Foundational papers sink to the top; recent derivatives flow downward."
    )
    n4, e4 = make_citation_dag()
    kgviz(
        nodes=n4, edges=e4,
        dag_mode="td",
        link_directional_arrow=True, arrow_size="medium",
        show_labels=True, label_outline=True,
        grain_density="light",
        warmup_ticks=300,
        key="citation_dag",
    )
    with st.expander("Real-world pipeline"):
        st.markdown("""
```python
import requests

def get_citations(paper_id: str):
    r = requests.get(
        f"https://api.semanticscholar.org/graph/v1/paper/{paper_id}/citations",
        params={"fields": "title,year,citationCount"},
    )
    return r.json()["data"]

# Build directed edges: citing_paper → cited_paper
# dag_mode="td" auto-arranges by citation depth (no coordinates needed)
```
        """)


# ─────────────────────────────────────────────────────────────────────────────
# TAB 5 — Topic Explorer
#
# 40 documents across 5 NLP research topics, positioned in 3-D embedding
# space (Gaussian clusters simulating UMAP output). Each document is
# connected to its 3 nearest neighbours by Euclidean distance.
#
# Real-world pipeline: sentence-transformers → BERTopic → UMAP 3D → KNN.
# ─────────────────────────────────────────────────────────────────────────────
def make_topic_explorer():
    rng = random.Random(42)

    TOPICS = {
        "Computer Vision":  {"color": "#ff0000", "center": (-90,  70,  25)},
        "NLP & LLMs":       {"color": "#00ffff", "center": ( 85,  60, -35)},
        "Knowledge Graphs": {"color": "#00ff00", "center": (-65, -85, -55)},
        "Reinforcement RL": {"color": "#ffcc00", "center": ( 75, -70,  65)},
        "Multimodal AI":    {"color": "#cc00ff", "center": (  5,  10,  95)},
    }

    DOC_TITLES: dict[str, list[str]] = {
        "Computer Vision": [
            "Image Recognition with Deep CNNs",
            "Object Detection using YOLO",
            "Semantic Segmentation Survey",
            "Vision Transformers for Dense Prediction",
            "Self-Supervised Visual Representation Learning",
            "3-D Point Cloud Understanding",
            "Video Understanding with Temporal Models",
            "Zero-Shot Object Detection via Language",
        ],
        "NLP & LLMs": [
            "Large Language Model Survey 2024",
            "Prompt Engineering Best Practices",
            "Efficient Fine-Tuning with LoRA",
            "LLM Alignment & Safety Overview",
            "Multilingual Pre-Training Strategies",
            "Long-Context Language Models",
            "Code Generation with LLMs",
            "Hallucination in Language Models",
        ],
        "Knowledge Graphs": [
            "Knowledge Graph Completion Survey",
            "Entity Alignment across Heterogeneous KGs",
            "Temporal Knowledge Graph Reasoning",
            "KG-Enhanced Language Models",
            "Commonsense Knowledge Graph Construction",
            "Biomedical KG for Drug Discovery",
            "Multimodal Knowledge Graphs",
            "Scalable KG Embedding Methods",
        ],
        "Reinforcement RL": [
            "Deep Q-Networks for Game Playing",
            "Proximal Policy Optimization",
            "Reward Shaping for Sparse Rewards",
            "Multi-Agent Reinforcement Learning",
            "Model-Based Reinforcement Learning",
            "RL from Human Feedback — RLHF",
            "Offline Reinforcement Learning",
            "Safe Exploration in RL",
        ],
        "Multimodal AI": [
            "Vision-Language Pre-Training",
            "Text-to-Image Generation Survey",
            "Audio-Visual Learning",
            "Grounded Language Understanding",
            "Multimodal Reasoning with LLMs",
            "Video-Text Retrieval",
            "Cross-Modal Transfer Learning",
            "Embodied AI and Grounding",
        ],
    }

    nodes = []
    for topic, info in TOPICS.items():
        cx, cy, cz = info["center"]
        for title in DOC_TITLES[topic]:
            nodes.append({
                "id": title, "label": title,
                "color": info["color"],
                "size": rng.randint(2, 6),
                "x": cx + rng.gauss(0, 28),
                "y": cy + rng.gauss(0, 28),
                "z": cz + rng.gauss(0, 28),
                "topic": topic,
            })

    # KNN edges (k=3) by Euclidean distance in embedding space
    def dist3(a: dict, b: dict) -> float:
        return math.sqrt(
            (a["x"] - b["x"]) ** 2 +
            (a["y"] - b["y"]) ** 2 +
            (a["z"] - b["z"]) ** 2
        )

    seen: set[tuple] = set()
    edges = []
    for i, node in enumerate(nodes):
        nearest = sorted(
            ((dist3(node, other), j) for j, other in enumerate(nodes) if j != i)
        )
        for _, j in nearest[:3]:
            key = (min(node["id"], nodes[j]["id"]), max(node["id"], nodes[j]["id"]))
            if key not in seen:
                seen.add(key)
                edges.append({"source": node["id"], "target": nodes[j]["id"]})

    return nodes, edges, list(TOPICS.keys()), [v["color"] for v in TOPICS.values()]


with tab5:
    st.subheader("Topic Explorer")
    st.caption(
        "40 documents positioned by embedding similarity (simulated UMAP).  "
        "Each document is connected to its 3 nearest neighbours.  "
        "Hover over nodes to see the document title."
    )
    n5, e5, topic_names, topic_colors = make_topic_explorer()
    kgviz(
        nodes=n5, edges=e5,
        use_coordinates=True,
        show_labels=False,
        grain_density="dense",
        key="topic_explorer",
    )
    # Legend
    cols = st.columns(5)
    for col, name, color in zip(cols, topic_names, topic_colors):
        col.markdown(
            f'<span style="display:inline-block;width:10px;height:10px;'
            f'border-radius:50%;background:{color};margin-right:5px;vertical-align:middle"></span>{name}',
            unsafe_allow_html=True,
        )
    with st.expander("Real-world pipeline"):
        st.markdown("""
```python
from sentence_transformers import SentenceTransformer
from bertopic import BERTopic
import umap, numpy as np
from sklearn.neighbors import NearestNeighbors

model = SentenceTransformer("all-MiniLM-L6-v2")
embeddings = model.encode(documents)               # (N, 384)

topic_model = BERTopic()
topics, _ = topic_model.fit_transform(documents, embeddings)

coords = umap.UMAP(n_components=3, random_state=42).fit_transform(embeddings)
coords = (coords * 100).tolist()    # scale for visual spread

nn = NearestNeighbors(n_neighbors=3).fit(embeddings)
_, indices = nn.kneighbors(embeddings)
edges = [{"source": titles[i], "target": titles[j]}
         for i, row in enumerate(indices) for j in row if i != j]
```
        """)


# ─────────────────────────────────────────────────────────────────────────────
# TAB 6 — Live Text Analysis
#
# User pastes any article or paragraph. Keywords are extracted with a simple
# stopword filter + frequency count. Two keywords share an edge when they
# co-occur within a 5-token sliding window (count ≥ threshold).
# Zero external dependencies required.
# ─────────────────────────────────────────────────────────────────────────────
STOPWORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of","with",
    "as","by","from","this","that","these","those","is","are","was","were",
    "be","been","being","have","has","had","do","does","did","will","would",
    "could","should","may","might","can","its","it","we","our","they","their",
    "he","she","his","her","you","your","i","me","my","us","also","which",
    "who","when","where","how","what","than","then","so","if","not","no",
    "all","each","any","more","most","very","such","into","over","about",
    "both","between","through","during","before","after","while","here",
    "there","than","just","been","only","other","same","used","using",
}

DEFAULT_TEXT = """\
Large Language Models have transformed natural language processing by enabling machines to \
understand and generate human-like text. These models, built on the Transformer architecture, \
learn rich representations through self-supervised pretraining on large corpora and can be \
fine-tuned for downstream tasks using instruction tuning or reinforcement learning from human \
feedback (RLHF).

Knowledge Graphs provide structured representations of real-world entities and their \
relationships as subject-predicate-object triples. When combined with language models, \
knowledge graphs offer factual grounding that reduces hallucination and improves reasoning. \
Retrieval-Augmented Generation (RAG) leverages this by retrieving relevant knowledge graph \
subgraphs to condition the model's output generation.

Entity extraction and relation detection are the core components of knowledge graph \
construction. Named entity recognition identifies mentions of people, organizations and \
concepts in text, while relation extraction determines how entities are connected. These \
extracted triples form the building blocks of a knowledge graph that can be queried and \
reasoned over.

Vector databases store dense embeddings of text chunks, enabling semantic search over \
large document collections. When a query arrives, its embedding is compared to stored \
embeddings using cosine similarity, and the most relevant documents are retrieved to \
augment generation. This retrieval process is essential for knowledge-intensive NLP tasks.
"""


def analyze_text(
    text: str, top_n: int = 24, window: int = 5, min_cooc: int = 2
) -> tuple[list[dict], list[dict]]:
    # Tokenize and filter stopwords (keep words ≥ 3 chars)
    tokens = [
        w.lower() for w in re.findall(r"\b[a-zA-Z][a-zA-Z\-']{2,}\b", text)
        if w.lower() not in STOPWORDS
    ]
    freq = Counter(tokens)

    # Also score bigrams (consecutive token pairs)
    bigrams = [f"{tokens[i]} {tokens[i+1]}" for i in range(len(tokens) - 1)]
    bigram_freq = Counter(b for b in bigrams if bigrams.count(b) >= 2)

    # Merge: bigrams that appear ≥ 2× get a bonus score
    combined = dict(freq)
    for bg, cnt in bigram_freq.items():
        combined[bg] = combined.get(bg, 0) + cnt

    # Top-N keywords
    top_keywords = [w for w, _ in sorted(combined.items(), key=lambda x: -x[1])[:top_n]]
    kw_set = set(top_keywords)

    max_freq = max((combined[k] for k in top_keywords), default=1)

    def node_color(kw: str) -> str:
        t = combined.get(kw, 1) / max_freq
        if t > 0.6:
            return "#e41a1c"   # hot — high frequency
        elif t > 0.3:
            return "#ff7f00"   # warm — medium frequency
        else:
            return "#377eb8"   # cool — lower frequency

    nodes = [
        {
            "id": kw, "label": kw,
            "color": node_color(kw),
            "size": max(2, min(12, combined.get(kw, 1) * 1.8)),
            "frequency": combined.get(kw, 1),
        }
        for kw in top_keywords
    ]

    # Sliding-window co-occurrence
    cooc: Counter = Counter()
    for i in range(len(tokens) - window + 1):
        window_tokens = [t for t in tokens[i:i + window] if t in kw_set]
        for a, b in combinations(sorted(set(window_tokens)), 2):
            cooc[(a, b)] += 1

    edges = [
        {"source": a, "target": b, "weight": cnt}
        for (a, b), cnt in cooc.items()
        if cnt >= min_cooc
    ]

    return nodes, edges


with tab6:
    st.subheader("Live Text Analysis")
    st.caption(
        "Paste any article or paragraph. Keywords are extracted and connected by "
        "co-occurrence within a sliding word window. No external libraries needed."
    )

    user_text = st.text_area(
        "Article text",
        value=DEFAULT_TEXT,
        height=220,
        key="live_text",
    )

    col_a, col_b, col_c = st.columns(3)
    top_n    = col_a.slider("Max keywords",         10, 40, 24, key="live_n")
    min_cooc = col_b.slider("Min co-occurrences",   1,  5,  2,  key="live_cooc")
    window   = col_c.slider("Co-occurrence window", 3,  10, 5,  key="live_win")

    if user_text.strip():
        live_nodes, live_edges = analyze_text(user_text, top_n, window, min_cooc)

        n_nodes = len(live_nodes)
        n_edges = len(live_edges)
        max_possible = n_nodes * (n_nodes - 1) // 2
        density = n_edges / max_possible if max_possible > 0 else 0

        m1, m2, m3 = st.columns(3)
        m1.metric("Keywords", n_nodes)
        m2.metric("Edges", n_edges)
        m3.metric("Graph density", f"{density:.1%}")

        kgviz(
            nodes=live_nodes, edges=live_edges,
            show_labels=True, label_outline=True,
            grain_density="light",
            warmup_ticks=60,
            key="live_graph",
        )

        st.caption(
            "Node colour: red = high frequency · orange = medium · blue = lower.  "
            "Node size ∝ frequency."
        )
    else:
        st.info("Enter some text above to generate a concept graph.")


# ─────────────────────────────────────────────────────────────────────────────
# TAB 7 — Embedding Map (PCA / t-SNE / UMAP / SOM)
# Cosmograph-style scatter: features → 2D layout → kgviz map_mode
# ─────────────────────────────────────────────────────────────────────────────
with tab7:
    st.subheader("Embedding Map")
    st.caption(
        "Build a 2D map from numeric features (e.g. paper embeddings). "
        "Inspired by Cosmograph — pan/zoom, search, click for details."
    )
    try:
        import numpy as np
        from kgviz import Graph3D
    except ImportError as e:
        st.error(f"Missing dependency: {e}")
        st.stop()

    method = st.selectbox(
        "Layout method",
        ["pca", "tsne", "umap", "som"],
        index=1,
        format_func=lambda m: {"pca": "PCA", "tsne": "t-SNE", "umap": "UMAP", "som": "SOM"}[m],
    )
    n_docs = st.slider("Number of documents", 80, 8000, 250, step=20)
    st.caption("Maps with ≥1500 points use WebGL instancing automatically.")
    knn_k = st.slider("KNN edges (0 = scatter only)", 0, 5, 0)

    rng = random.Random(42)
    np_rng = np.random.default_rng(42)
    topics = ["Physics", "Biology", "ML", "Math", "Chemistry"]
    nodes = []
    rows = []
    per = max(1, n_docs // len(topics))
    for t_idx, topic in enumerate(topics):
        center = np_rng.normal(0, 1, 24) + t_idx * 2.2
        for i in range(per):
            if len(nodes) >= n_docs:
                break
            title = f"{topic[:3]} {rng.randint(10000, 99999)}: sample abstract {i}"
            nodes.append({
                "id": title,
                "label": title[:42] + "…",
                "topic": topic,
            })
            rows.append(center + np_rng.normal(0, 0.4, 24))
    features = np.vstack(rows[: len(nodes)])

    with st.spinner(f"Computing {method.upper()} layout…"):
        fig = Graph3D.from_map(
            nodes,
            features,
            method=method,
            knn_k=knn_k,
            node_color_by="topic",
            legend_node_by="topic",
            height=650,
        )

    event = kgviz(**fig.to_dict(), key="embedding_map")

    if event and isinstance(event, dict):
        if event.get("type") == "node_click":
            with st.expander("Document details", expanded=True):
                st.json(event.get("node", {}))
        elif event.get("type") == "selection_change":
            st.caption(f"Selected: {len(event.get('node_ids', []))} documents")

    st.markdown(
        "**Usage with real embeddings:** `Graph3D.from_map(nodes, embeddings, method='tsne')` "
        "after `sentence_transformers` or BERTopic. Install: `pip install 'kgviz[maps]'`"
    )
