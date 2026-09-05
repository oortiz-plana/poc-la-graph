-- synthetic count routine (fixture, no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  function count_employees return number is
    select count(*) into l_total from employees;
