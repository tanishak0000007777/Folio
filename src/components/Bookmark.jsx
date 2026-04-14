const handleBookmark = async () => {
  const { error } = await supabase.from("bookmarks").insert([
    {
      book_id: id,
      page_number: pageNum,
    },
  ]);

  if (error) {
    console.error(error);
    alert("Bookmark failed");
  } else {
    showToast("Bookmarked ⭐");
  }
};