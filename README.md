# Evalchain

A Bubblemaps-inspired tool for the 42 Network. Enter a login and see who has evaluated that student and how often — surfacing clusters of repeat evaluators as an interactive force-directed graph.

## What it does

- Pulls a student's evaluation history from the 42 Intra API (`scale_teams`)
- Computes an evaluation-diversity score: ratio of unique evaluators to total evaluations, weighted by cluster tightness
- Detects clusters of students who share the same pool of evaluators (Jaccard similarity)
- Visualizes the result as a force-directed bubble map — bubble size = evaluation frequency, edges = shared evaluators

## Status

Early prototype. Internal codename: `Cheatmap`.
