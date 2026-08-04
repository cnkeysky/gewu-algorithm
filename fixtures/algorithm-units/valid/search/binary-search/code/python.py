from collections.abc import Sequence


def binary_search(values: Sequence[int], target: int) -> int:
    left = 0
    right = len(values) - 1

    while left <= right:
        middle = left + (right - left) // 2
        value = values[middle]
        if value == target:
            return middle
        if value < target:
            left = middle + 1
        else:
            right = middle - 1

    return -1
