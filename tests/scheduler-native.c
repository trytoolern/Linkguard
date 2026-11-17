#include <assert.h>
#include "../benchmarks/scheduler.c"
int main(void) {
  assert(lg_init(0, 1) == -1);
  assert(lg_init(2, 1) == 0);
  assert(lg_add(-1) == -1);
  assert(lg_add(1) == -1);
  assert(lg_add(0) == 0); assert(lg_add(0) == 1); assert(lg_add(1) == 2);
  assert(lg_acquire() == 0); assert(lg_acquire() == 2); assert(lg_acquire() == -1);
  assert(lg_release(0) == 0); assert(lg_release(0) == -1); assert(lg_release(1001) == -1);
  assert(lg_acquire() == 1); assert(lg_acquire() == -1);
  assert(lg_release(1) == 0); assert(lg_release(2) == 0); assert(lg_acquire() == -1);
  assert(lg_init(32, 8) == 0);
  for (int i = 0; i < MAX_TASKS; i++) assert(lg_add(i) == i);
  assert(lg_add(0) == -1);
  return 0;
}
