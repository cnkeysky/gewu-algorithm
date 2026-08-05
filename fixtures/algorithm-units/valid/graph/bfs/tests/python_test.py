from code.python import bfs


def test_bfs_reaches_each_vertex_once():
    assert bfs([[1, 2], [3], [3], []], 0) == [0, 1, 2, 3]
